import { spawn } from "node:child_process";
import { randomUUID, createHmac, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

import ffmpegPath from "ffmpeg-static";
import { requestChatResponse } from "./upstream-chat.mjs";
import {
  cleanTranscriptRepetition,
  isBudgetExceededMessage,
  mergeTranscriptSegments,
  redactApiSecrets,
} from "../lib/iai-workflow.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.IAI_BRIDGE_PORT || 4175);
const IAI_ASR_URL =
  process.env.IAI_ASR_URL ||
  "https://www.iai.nkust.edu.tw/aihub/v1/audio/transcriptions";
const IAI_CHAT_URL =
  process.env.IAI_CHAT_URL ||
  "https://www.iai.nkust.edu.tw/aihub/v1/chat/completions";
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_AUDIO_BYTES + 1024 * 1024;
const MAX_CHAT_REQUEST_BYTES = 2 * 1024 * 1024;
const CHAT_HEARTBEAT_MS = Math.max(
  1_000,
  Number(process.env.IAI_CHAT_HEARTBEAT_MS || 10_000),
);
const SEGMENT_SECONDS = 180;
const REMOTE_ATTEMPTS = 3;
const configuredOrigins = new Set(
  (process.env.IAI_ALLOWED_ORIGINS || "").split(",").filter(Boolean),
);
// Credential-isolated, RAM-only deduplication. A lost browser connection must
// not cause a second billed request for the same selected model and messages.
const chatCacheSalt = randomBytes(32);
const chatJobs = new Map();
const CHAT_CACHE_TTL = 30 * 60_000;
const CHAT_CACHE_BYTES = 16 * 1024 * 1024;
const CHAT_PENDING_LIMIT = 8;
function pruneChatJobs() {
  const now = Date.now();
  for (const [key, job] of chatJobs)
    if (job.finishedAt && now - job.finishedAt > CHAT_CACHE_TTL)
      chatJobs.delete(key);
  let bytes = [...chatJobs.values()].reduce(
    (n, job) => n + (job.bytes || 0),
    0,
  );
  for (const [key, job] of chatJobs) {
    if (bytes <= CHAT_CACHE_BYTES && chatJobs.size <= 64) break;
    if (job.finishedAt) {
      bytes -= job.bytes || 0;
      chatJobs.delete(key);
    }
  }
}
const chatCacheCleanup = setInterval(pruneChatJobs, 60_000);
chatCacheCleanup.unref();
function sharedChatJob(authorization, payload) {
  pruneChatJobs();
  const body = JSON.stringify(payload);
  const key = createHmac("sha256", chatCacheSalt)
    .update(authorization)
    .update("\0")
    .update(body)
    .digest("hex");
  if (chatJobs.has(key)) return chatJobs.get(key).promise;
  if (
    [...chatJobs.values()].filter((job) => !job.finishedAt).length >=
    CHAT_PENDING_LIMIT
  )
    throw Object.assign(
      new Error("處理器忙碌，請稍後續跑；尚未送出新的 IAI 請求。"),
      { status: 429 },
    );
  const job = { finishedAt: 0, bytes: 0, promise: null };
  // Insert before fetch so concurrent identical submissions share this promise.
  chatJobs.set(key, job);
  job.promise = (async () => {
    try {
      const upstream = await requestChatResponse(IAI_CHAT_URL, {
        authorization,
        body,
      });
      authorization = "";
      const raw = upstream.body;
      if (!upstream.ok) {
        chatJobs.delete(key);
        return {
          error: true,
          status: upstream.status,
          retryAfter: upstream.retryAfter,
          message: errorMessage(raw, `IAI 回傳 HTTP ${upstream.status}`),
        };
      }
      let result;
      try {
        result = raw ? JSON.parse(raw) : null;
      } catch {
        throw new Error("LLM 回傳格式不是有效的 JSON。");
      }
      if (!result) throw new Error("LLM 沒有回傳結果。");
      job.finishedAt = Date.now();
      job.bytes = Buffer.byteLength(raw);
      if (job.bytes > CHAT_CACHE_BYTES) chatJobs.delete(key);
      pruneChatJobs();
      return { error: false, payload: result };
    } catch (error) {
      chatJobs.delete(key);
      throw error;
    } finally {
      authorization = "";
    }
  })();
  return job.promise;
}

function allowedOrigin(origin = "") {
  return (
    configuredOrigins.has(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
  );
}

function responseHeaders(origin, extra = {}) {
  return {
    "access-control-allow-origin": allowedOrigin(origin)
      ? origin
      : "http://localhost:3000",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extra,
  };
}

function sendJson(response, status, payload, origin = "") {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(
    status,
    responseHeaders(origin, {
      "content-type": "application/json; charset=utf-8",
    }),
  );
  response.end(JSON.stringify(payload));
}

function startEventStream(response, origin = "") {
  response.writeHead(
    200,
    responseHeaders(origin, {
      "content-type": "application/x-ndjson; charset=utf-8",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "cache-control": "no-cache, no-store, no-transform",
    }),
  );
  response.flushHeaders?.();
}

function sendEvent(response, payload) {
  if (response.destroyed || response.writableEnded) return;
  response.write(`${JSON.stringify(payload)}\n`);
}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

async function readRequest(request, maxBytes = MAX_REQUEST_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error(
        maxBytes === MAX_CHAT_REQUEST_BYTES
          ? "LLM 請求內容過大。"
          : "本機處理器最多接受 30 MB 錄音。",
      );
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function safeExtension(name) {
  const extension = extname(name).toLowerCase();
  return [".mp3", ".m4a", ".wav"].includes(extension) ? extension : ".audio";
}

function runFfmpeg(inputPath, outputPattern, signal) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("找不到本機 ffmpeg。請重新執行 pnpm install。"));
      return;
    }
    const child = spawn(
      ffmpegPath,
      [
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "32k",
        "-f",
        "segment",
        "-segment_time",
        String(SEGMENT_SECONDS),
        "-reset_timestamps",
        "1",
        outputPattern,
      ],
      { windowsHide: true },
    );
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => {
      child.kill();
      finish(() => reject(abortError()));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8000);
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) =>
      finish(() =>
        code === 0
          ? resolve()
          : reject(
              new Error(`錄音轉碼失敗：${stderr.trim() || `ffmpeg ${code}`}`),
            ),
      ),
    );
  });
}

function extractTranscript(payload) {
  if (typeof payload === "string") return payload.trim();
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.text === "string") return payload.text.trim();
  if (typeof payload.transcript === "string") return payload.transcript.trim();
  if (payload.data) return extractTranscript(payload.data);
  if (Array.isArray(payload.segments)) {
    return payload.segments
      .map((segment) =>
        segment && typeof segment.text === "string" ? segment.text : "",
      )
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function errorMessage(raw, fallback) {
  raw = redactApiSecrets(raw);
  if (/<(?:!doctype|html|head|body)\b/i.test(raw)) {
    if (
      /\b524\b[\s\S]{0,120}(?:timeout|逾時)|(?:timeout|逾時)[\s\S]{0,120}\b524\b/i.test(
        raw,
      )
    )
      return "高科 iAI 上游處理逾時（HTTP 524）。";
    return `${fallback}（上游服務回傳網頁錯誤，已隱藏原始 HTML）`;
  }
  try {
    const payload = JSON.parse(raw);
    return payload?.error?.message || payload?.message || fallback;
  } catch {
    return raw.trim().slice(0, 500) || fallback;
  }
}

async function handleChatCompletion(request, response, origin) {
  const startedAt = Date.now();
  if (!allowedOrigin(origin)) {
    sendJson(
      response,
      403,
      { error: { message: "只允許網站本身呼叫 LLM 處理器。" } },
      origin,
    );
    return;
  }
  let authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    sendJson(response, 401, { error: { message: "缺少 API Key。" } }, origin);
    return;
  }

  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
    if (heartbeat) clearInterval(heartbeat);
  });
  let heartbeat;
  let streamStarted = false;
  try {
    const body = await readRequest(request, MAX_CHAT_REQUEST_BYTES);
    let payload;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      const error = new Error("LLM 請求不是有效的 JSON。");
      error.status = 400;
      throw error;
    }
    if (
      !Array.isArray(payload?.messages) ||
      typeof payload?.model !== "string"
    ) {
      const error = new Error("LLM 請求缺少模型或訊息。");
      error.status = 400;
      throw error;
    }

    process.stdout.write(
      `[LLM] Incoming chat, ${payload.messages.length} msgs, max_tokens=${payload.max_tokens ?? "default"}\n`,
    );

    startEventStream(response, origin);
    streamStarted = true;
    sendEvent(response, {
      type: "progress",
      stage: "waiting",
      message: "請勿關閉此頁面；iAI 已收到內容，正在處理。",
    });
    heartbeat = setInterval(
      () =>
        sendEvent(response, {
          type: "progress",
          stage: "waiting",
          message: "iAI 仍在處理；連線正常，請勿關閉此頁面。",
        }),
      CHAT_HEARTBEAT_MS,
    );
    heartbeat.unref?.();

    let result;
    try {
      result = await sharedChatJob(authorization, payload);
    } catch (error) {
      if (controller.signal.aborted) throw abortError();
      process.stdout.write(
        `[LLM] Upstream fetch error after ${Date.now() - startedAt}ms: ${error instanceof Error ? error.message : "network error"}\n`,
      );
      throw new Error(
        `連線高科 iAI 失敗：${error instanceof Error ? error.message : "網路錯誤"}`,
      );
    }
    process.stdout.write(
      `[LLM] Result available in ${Date.now() - startedAt}ms\n`,
    );
    if (result.error) {
      // Provider error payloads can echo credentials or user content. Keep
      // only the status/size/timing log above, never the raw error body.
      sendEvent(response, {
        type: "error",
        status: result.status,
        retryAfter: result.retryAfter,
        message: result.message,
      });
      response.end();
      return;
    }
    sendEvent(response, { type: "result", payload: result.payload });
    response.end();
  } catch (error) {
    if (controller.signal.aborted) {
      process.stdout.write(
        `[LLM] Client disconnected after ${Date.now() - startedAt}ms\n`,
      );
      return;
    }
    const status = Number.isInteger(error?.status) ? error.status : 502;
    const message = error instanceof Error ? error.message : "LLM 處理失敗。";
    process.stdout.write(`[LLM] Handler caught error ${status}\n`);
    if (streamStarted) {
      sendEvent(response, { type: "error", status, message });
      response.end();
    } else {
      sendJson(response, status, { error: { message } }, origin);
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    authorization = "";
  }
}

function retryDelay(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(30_000, seconds * 1000);
  return Math.min(12_000, 1500 * 2 ** attempt);
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(abortError());
      },
      { once: true },
    );
  });
}

async function transcribePart(partPath, authorization, signal, onRetry) {
  const bytes = await readFile(partPath);
  for (let attempt = 0; attempt < REMOTE_ATTEMPTS; attempt += 1) {
    const form = new FormData();
    form.append(
      "file",
      new File([bytes], basename(partPath), { type: "audio/mpeg" }),
    );
    form.append("model", "Asr");
    form.append("response_format", "json");
    form.append("language", "zh");

    let response;
    try {
      response = await fetch(IAI_ASR_URL, {
        method: "POST",
        headers: { Authorization: authorization },
        body: form,
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw abortError();
      throw new Error(
        `連線高科 iAI 失敗：${error instanceof Error ? error.message : "網路錯誤"}`,
      );
    }

    const raw = await response.text();
    if (response.ok) {
      let payload = raw;
      try {
        payload = JSON.parse(raw);
      } catch {
        // The bridge also accepts a plain-text transcription response.
      }
      const text = extractTranscript(payload);
      if (!text) throw new Error("IAI 已回應，但分段逐字稿是空白。");
      return text;
    }

    const message = errorMessage(raw, "轉錄失敗");
    if (isBudgetExceededMessage(`${message}\n${raw}`)) {
      throw new Error(
        "iAI API 額度已用完（budget_exceeded），不是 Asr 未回應。請到高科 iAI 後台提高或重設額度後再試。",
      );
    }
    const retryable = [429, 503, 504].includes(response.status);
    if (!retryable || attempt === REMOTE_ATTEMPTS - 1) {
      throw new Error(`IAI HTTP ${response.status}：${message}`);
    }
    onRetry?.({ attempt: attempt + 1, status: response.status });
    await wait(retryDelay(response, attempt), signal);
  }
  throw new Error("IAI 分段轉錄重試次數已用完。");
}

async function handleTranscription(request, response, origin) {
  if (!allowedOrigin(origin)) {
    sendJson(
      response,
      403,
      { error: { message: "只允許本機 DEMO 呼叫錄音處理器。" } },
      origin,
    );
    return;
  }
  let authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    sendJson(response, 401, { error: { message: "缺少 API Key。" } }, origin);
    return;
  }

  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
  });
  let workspace = "";
  let streamStarted = false;
  try {
    const body = await readRequest(request);
    const contentType = request.headers["content-type"] || "";
    const form = await new Response(body, {
      headers: { "content-type": contentType },
    }).formData();
    const audio = form.get("file");
    if (!(audio instanceof File) || audio.size === 0) {
      const error = new Error("沒有收到有效錄音檔。");
      error.status = 400;
      throw error;
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      const error = new Error("單一錄音檔不可超過 30 MB。");
      error.status = 413;
      throw error;
    }

    startEventStream(response, origin);
    streamStarted = true;
    sendEvent(response, {
      type: "progress",
      stage: "preparing",
      percent: 4,
      message: "錄音已送達本機處理器，正在準備轉碼。",
    });

    workspace = await mkdtemp(join(tmpdir(), `iai-audio-${randomUUID()}-`));
    const inputPath = join(workspace, `input${safeExtension(audio.name)}`);
    const outputPattern = join(workspace, "segment-%03d.mp3");
    await writeFile(inputPath, Buffer.from(await audio.arrayBuffer()));
    sendEvent(response, {
      type: "progress",
      stage: "preparing",
      percent: 10,
      message: `正在壓縮錄音並切成 ${SEGMENT_SECONDS / 60} 分鐘中文辨識小段。`,
    });
    await runFfmpeg(inputPath, outputPattern, controller.signal);

    const segments = (await readdir(workspace))
      .filter((name) => /^segment-\d+\.mp3$/.test(name))
      .sort();
    if (segments.length === 0)
      throw new Error("錄音轉碼完成，但沒有產生可上傳的分段。");

    process.stdout.write(
      `Processing ${audio.size} bytes as ${segments.length} segment(s).\n`,
    );
    sendEvent(response, {
      type: "progress",
      stage: "transcribing",
      percent: 18,
      current: 0,
      total: segments.length,
      message: `轉碼完成，將逐段送往高科 iAI（共 ${segments.length} 段）。`,
    });
    const transcripts = [];
    for (let index = 0; index < segments.length; index += 1) {
      sendEvent(response, {
        type: "progress",
        stage: "transcribing",
        percent: 18 + Math.round((index / segments.length) * 72),
        current: index,
        total: segments.length,
        message: `第 ${index + 1}/${segments.length} 段已送往 Asr，等待 iAI 回傳。`,
      });
      const text = await transcribePart(
        join(workspace, segments[index]),
        authorization,
        controller.signal,
        ({ attempt, status }) =>
          sendEvent(response, {
            type: "progress",
            stage: "waiting",
            percent: 18 + Math.round((index / segments.length) * 72),
            current: index,
            total: segments.length,
            message: `第 ${index + 1} 段收到 HTTP ${status}，正在等待後重試（第 ${attempt} 次）。`,
          }),
      );
      transcripts.push(cleanTranscriptRepetition(text));
      process.stdout.write(
        `IAI segment ${index + 1}/${segments.length} completed.\n`,
      );
      sendEvent(response, {
        type: "progress",
        stage: "transcribing",
        percent: 18 + Math.round(((index + 1) / segments.length) * 72),
        current: index + 1,
        total: segments.length,
        message: `IAI 已回傳第 ${index + 1}/${segments.length} 段逐字稿。`,
      });
    }

    const cleanedTranscript = mergeTranscriptSegments(transcripts);
    sendEvent(response, {
      type: "result",
      text: cleanedTranscript,
      bridge: {
        input_bytes: audio.size,
        segments: segments.length,
        segment_seconds: SEGMENT_SECONDS,
        repetition_cleanup: true,
      },
    });
    response.end();
  } catch (error) {
    if (controller.signal.aborted) return;
    const status = Number.isInteger(error?.status) ? error.status : 502;
    const message =
      error instanceof Error ? error.message : "本機錄音處理失敗。";
    if (streamStarted) {
      sendEvent(response, { type: "error", message });
      response.end();
    } else {
      sendJson(response, status, { error: { message } }, origin);
    }
  } finally {
    authorization = "";
    if (workspace) await rm(workspace, { recursive: true, force: true });
  }
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin || "";
  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204, responseHeaders(origin));
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(
      response,
      200,
      {
        ok: true,
        max_audio_bytes: MAX_AUDIO_BYTES,
        segment_seconds: SEGMENT_SECONDS,
        ffmpeg: Boolean(ffmpegPath),
      },
      origin,
    );
    return;
  }
  if (
    request.method === "POST" &&
    url.pathname === "/v1/audio/transcriptions"
  ) {
    await handleTranscription(request, response, origin);
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    await handleChatCompletion(request, response, origin);
    return;
  }
  sendJson(response, 404, { error: { message: "Not found" } }, origin);
});

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `IAI local audio bridge listening on http://${HOST}:${PORT}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

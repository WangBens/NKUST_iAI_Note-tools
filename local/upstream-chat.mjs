import http from "node:http";
import https from "node:https";

/** Node's fetch may hit its independent 300s header deadline before the 15m
 * AbortSignal. Native HTTP makes the one explicit lifetime bound authoritative.
 * TLS verification is unchanged; credentials stay in this request's memory. */
export function requestChatResponse(
  url,
  { authorization, body, timeoutMs = 15 * 60_000, maxBytes = 16 * 1024 * 1024 },
) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    const request =
      endpoint.protocol === "https:" ? https.request : http.request;
    if (!["https:", "http:"].includes(endpoint.protocol)) {
      reject(Error("不支援的 IAI 協定"));
      return;
    }
    const req = request(
      endpoint,
      {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          "Accept-Encoding": "identity",
          "Content-Length": Buffer.byteLength(body),
        },
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        const chunks = [];
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            reject(Error("IAI 回覆超過處理器安全大小限制"));
            res.destroy();
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.once("end", () =>
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            retryAfter: res.headers["retry-after"] ?? null,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
    authorization = "";
  });
}

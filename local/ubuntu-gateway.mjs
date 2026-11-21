import http from "node:http";
import https from "node:https";

const hopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function startGatewayServer({
  port = Number(process.env.STUDY_PORT || 3000),
  hosts = (process.env.STUDY_HOSTS || "127.0.0.1").split(","),
  webPort = Number(process.env.STUDY_WEB_PORT || 3001),
  bridgePort = Number(process.env.IAI_BRIDGE_PORT || 4175),
  iaiBase = process.env.STUDY_IAI_BASE ||
    "https://www.iai.nkust.edu.tw/aihub/v1",
  timeout = 60 * 60 * 1000,
} = {}) {
  function fail(response, status, message) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify({ error: { message } }));
  }

  function handle(request, response) {
    if (!/^[A-Za-z0-9.:[\]-]+(?::\d{1,5})?$/.test(request.headers.host || ""))
      return fail(response, 403, "Host not allowed");
    if (!request.url?.startsWith("/") || request.url.startsWith("//"))
      return fail(response, 400, "Invalid request");
    const pathname = request.url.split("?")[0];
    let target;
    let api = false;
    if (pathname.startsWith("/api/")) {
      api = true;
      const origin = request.headers.origin;
      let originHost = "";
      try {
        originHost = origin ? new URL(origin).host : "";
      } catch {
        return fail(response, 403, "Origin not allowed");
      }
      if (
        (originHost && originHost !== request.headers.host) ||
        request.headers["sec-fetch-site"] === "cross-site"
      ) {
        return fail(response, 403, "Origin not allowed");
      }
      if (pathname === "/api/audio/health" && request.method === "GET") {
        target = `http://127.0.0.1:${bridgePort}/health`;
      } else if (
        pathname === "/api/audio/v1/audio/transcriptions" &&
        request.method === "POST"
      ) {
        target = `http://127.0.0.1:${bridgePort}/v1/audio/transcriptions`;
      } else if (
        pathname === "/api/audio/v1/chat/completions" &&
        request.method === "POST"
      ) {
        target = `http://127.0.0.1:${bridgePort}/v1/chat/completions`;
      } else if (pathname === "/api/iai/models" && request.method === "GET") {
        target = `${iaiBase}/models`;
      } else if (
        pathname === "/api/iai/chat/completions" &&
        request.method === "POST"
      ) {
        target = `${iaiBase}/chat/completions`;
      } else {
        return fail(response, 404, "API route not found");
      }
      if (
        !pathname.endsWith("/health") &&
        !request.headers.authorization?.startsWith("Bearer ")
      ) {
        return fail(response, 401, "缺少 API Key。");
      }
    } else {
      target = `http://127.0.0.1:${webPort}${request.url}`;
    }
    const maxBytes = pathname.startsWith("/api/audio/")
      ? 31 * 1024 * 1024
      : 12 * 1024 * 1024;
    if (Number(request.headers["content-length"] || 0) > maxBytes)
      return fail(response, 413, "Request too large");
    const targetUrl = new URL(target);
    const headers = api
      ? Object.fromEntries(
          ["authorization", "content-type", "content-length", "accept"]
            .filter((key) => request.headers[key])
            .map((key) => [key, request.headers[key]]),
        )
      : Object.fromEntries(
          Object.entries(request.headers).filter(
            ([key]) => !hopHeaders.has(key),
          ),
        );
    headers.host = targetUrl.host;
    if (pathname.startsWith("/api/audio/"))
      headers.origin = "http://127.0.0.1:3000";
    const upstream = (targetUrl.protocol === "https:" ? https : http).request(
      targetUrl,
      {
        method: request.method,
        headers,
        timeout,
      },
      (incoming) => {
        const outgoing = Object.fromEntries(
          Object.entries(incoming.headers).filter(
            ([key]) =>
              !hopHeaders.has(key) &&
              (!api || !key.startsWith("access-control-")),
          ),
        );
        if (api) outgoing["cache-control"] = "no-store";
        if (pathname.startsWith("/api/audio/v1/")) {
          outgoing["x-accel-buffering"] = "no";
        }
        outgoing["x-content-type-options"] = "nosniff";
        outgoing["x-frame-options"] = "DENY";
        outgoing["referrer-policy"] = "no-referrer";
        outgoing["permissions-policy"] =
          "camera=(), microphone=(), geolocation=()";
        outgoing["content-security-policy"] =
          "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
        response.writeHead(incoming.statusCode, outgoing);
        incoming.on("error", () => response.destroy());
        incoming.pipe(response);
      },
    );
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        fail(response, 413, "Request too large");
        upstream.destroy();
      }
    });
    upstream.on("timeout", () => {
      fail(response, 504, "Upstream timeout");
      upstream.destroy();
    });
    upstream.on("error", () => {
      if (!response.destroyed && !response.writableEnded)
        fail(response, 502, "服務暫時無法連線，請稍後再試。");
    });
    request.on("aborted", () => upstream.destroy());
    response.on("close", () => {
      if (!response.writableEnded) upstream.destroy();
    });
    request.pipe(upstream);
  }

  return Promise.all(
    hosts.map(
      (host) =>
        new Promise((resolve, reject) => {
          const server = http.createServer(handle);
          server.requestTimeout = timeout;
          server.setTimeout(timeout);
          server.once("error", reject);
          server.listen(port, host, () => {
            const actualPort = server.address()?.port ?? port;
            console.log(`Study notes ready at http://${host}:${actualPort}`);
            resolve({ server, host, port: actualPort });
          });
        }),
    ),
  );
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isDirectRun) {
  startGatewayServer().then((entries) => {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => {
        for (const { server } of entries) server.close();
        setTimeout(() => process.exit(0), 10_000).unref();
      });
    }
  });
}

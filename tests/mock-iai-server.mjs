import http from 'node:http';

const PORT = Number(process.env.MOCK_IAI_PORT || 4174);
const VALID_KEY = 'test-valid-key';
const ASR_TEXT = process.env.MOCK_ASR_TEXT || '這是瀏覽器自動化測試錄音的逐字稿。老師說明第一章重點，並提醒下週繳交作業。';
const CHAT_DELAY_MS = Number(process.env.MOCK_CHAT_DELAY_MS || 0);
const CHAT_LOADING_ATTEMPTS = Number(process.env.MOCK_CHAT_LOADING_ATTEMPTS ?? 2);
let chatAttempts = 0;

function corsHeaders(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    ...extra,
  };
}

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, corsHeaders({
    'content-type': 'application/json; charset=utf-8',
    ...extraHeaders,
  }));
  response.end(JSON.stringify(body));
}

function readSlowly(request) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    request.on('data', (chunk) => {
      bytes += chunk.length;
    });
    request.on('end', () => {
      resolve(bytes);
    });
    request.on('error', reject);
    request.on('aborted', () => reject(new Error('request aborted')));
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }

  if (request.headers.authorization !== `Bearer ${VALID_KEY}`) {
    sendJson(response, 401, { error: { message: 'Invalid API key' } });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/models') {
    sendJson(response, 200, {
      data: [
        { id: 'Asr' },
        { id: 'Nkust' },
        { id: 'Furen-omni' },
        { id: 'Furen-std' },
        { id: 'Furen-coder' },
        { id: 'Furen-large' },
        { id: 'Furen-max' },
      ],
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/audio/transcriptions') {
    let bytes;
    try {
      bytes = await readSlowly(request);
    } catch {
      process.stdout.write('ASR upload cancelled by client\n');
      return;
    }
    if (response.destroyed) return;
    await new Promise((resolve) => setTimeout(resolve, 700));
    sendJson(response, 200, {
      text: ASR_TEXT,
      received_bytes: bytes,
    });
    process.stdout.write(`ASR received ${bytes} bytes\n`);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
    let bytes;
    try {
      bytes = await readSlowly(request);
    } catch {
      process.stdout.write('CHAT request cancelled by client\n');
      return;
    }
    if (response.destroyed) return;
    chatAttempts += 1;
    if (CHAT_DELAY_MS > 0)
      await new Promise((resolve) => setTimeout(resolve, CHAT_DELAY_MS));
    if (chatAttempts <= CHAT_LOADING_ATTEMPTS) {
      sendJson(response, 503, {
        error: { message: `Model is loading (${chatAttempts}/2)` },
      }, { 'retry-after': '1' });
      process.stdout.write(`CHAT loading response ${chatAttempts}, ${bytes} bytes\n`);
      return;
    }
    sendJson(response, 200, {
      choices: [{
        message: {
          content: '# 錄音重點\n\n## 課程摘要\n\n- 第一章是本次課程重點。\n- 下週需要繳交作業。',
        },
      }],
    });
    process.stdout.write(`CHAT success ${chatAttempts}, ${bytes} bytes\n`);
    return;
  }

  sendJson(response, 404, { error: { message: 'Not found' } });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Mock IAI server listening on http://127.0.0.1:${PORT}/v1\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

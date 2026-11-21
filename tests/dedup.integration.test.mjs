import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

test('bridge deduplicates concurrent and disconnected requests, isolates different API keys', async (t) => {
  let upstreamCalls = 0;
  const upstream = http.createServer(async (req, res) => {
    for await (const chunk of req) {
    }
    upstreamCalls++;
    await new Promise((resolve) => setTimeout(resolve, 150));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: '## 整流\n二極體單向導通。' },
          },
        ],
      }),
    );
  });
  await new Promise((resolve) => upstream.listen(4286, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const bridge = spawn(
    process.execPath,
    ['--experimental-strip-types', 'local/iai-bridge.mjs'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        IAI_BRIDGE_PORT: '4287',
        IAI_CHAT_URL: 'http://127.0.0.1:4286/v1/chat/completions',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  t.after(() => bridge.kill());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('bridge startup timeout')),
      10000,
    );
    bridge.stdout.on('data', (chunk) => {
      if (/listening/i.test(chunk.toString())) {
        clearTimeout(timer);
        resolve();
      }
    });
    bridge.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('bridge exited'));
    });
  });
  const call = async (key = 'key-a', text = 'source') => {
    const response = await fetch('http://127.0.0.1:4287/v1/chat/completions', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'Furen-std',
        messages: [{ role: 'user', content: text }],
      }),
    });
    return (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  };
  const [a, b] = await Promise.all([call(), call()]);
  assert.equal(upstreamCalls, 1);
  assert.ok(a.some((e) => e.type === 'result'));
  assert.ok(b.some((e) => e.type === 'result'));
  await call();
  assert.equal(upstreamCalls, 1);
  await call('key-b');
  assert.equal(upstreamCalls, 2);
  const response = await fetch('http://127.0.0.1:4287/v1/chat/completions', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:3000',
      Authorization: 'Bearer key-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'Furen-std',
      messages: [{ role: 'user', content: 'disconnect fixture' }],
    }),
  });
  await response.body.cancel();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const restored = await call('key-a', 'disconnect fixture');
  assert.equal(upstreamCalls, 3);
  assert.ok(restored.some((e) => e.type === 'result'));
});

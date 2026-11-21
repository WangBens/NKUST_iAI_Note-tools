import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const MOCK_PORT = 4274;
const BRIDGE_PORT = 4275;

function waitForLine(child, pattern, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}: ${output}`)), timeoutMs);
    const onData = (chunk) => {
      output += chunk.toString();
      if (!pattern.test(output)) return;
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      resolve();
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Child exited with ${code}: ${output}`));
    });
  });
}

function makeSilentWav() {
  const sampleRate = 16_000;
  const samples = sampleRate;
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

test('local audio bridge streams real stage events and cleans repeated ASR output', async (context) => {
  const repeatedText = `課程開始。${'電子學'.repeat(24)}課程結束。`;
  const mock = spawn(process.execPath, ['tests/mock-iai-server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, MOCK_IAI_PORT: String(MOCK_PORT), MOCK_ASR_TEXT: repeatedText },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(() => mock.kill('SIGKILL'));
  await waitForLine(mock, /Mock IAI server listening/);

  const bridge = spawn(process.execPath, ['--experimental-strip-types', 'local/iai-bridge.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      IAI_BRIDGE_PORT: String(BRIDGE_PORT),
      IAI_ASR_URL: `http://127.0.0.1:${MOCK_PORT}/v1/audio/transcriptions`,
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(() => bridge.kill('SIGKILL'));
  await waitForLine(bridge, /IAI local audio bridge listening/);

  const form = new FormData();
  form.append('file', new File([makeSilentWav()], 'test.wav', { type: 'audio/wav' }));
  form.append('model', 'Asr');
  const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:3000', Authorization: 'Bearer test-valid-key' },
    body: form,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/x-ndjson/);
  const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.type === 'progress' && event.stage === 'preparing'));
  assert.ok(events.some((event) => event.type === 'progress' && event.stage === 'transcribing'));
  const result = events.find((event) => event.type === 'result');
  assert.ok(result);
  assert.equal((result.text.match(/電子學/g) ?? []).length, 1);
  assert.equal(result.bridge.repetition_cleanup, true);
});

test('LLM bridge sends heartbeat events while a slow model is working', async (context) => {
  const mockPort = MOCK_PORT + 10;
  const bridgePort = BRIDGE_PORT + 10;
  const mock = spawn(process.execPath, ['tests/mock-iai-server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MOCK_IAI_PORT: String(mockPort),
      MOCK_CHAT_DELAY_MS: '2300',
      MOCK_CHAT_LOADING_ATTEMPTS: '0',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(() => mock.kill('SIGKILL'));
  await waitForLine(mock, /Mock IAI server listening/);

  const bridge = spawn(process.execPath, ['--experimental-strip-types', 'local/iai-bridge.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      IAI_BRIDGE_PORT: String(bridgePort),
      IAI_CHAT_URL: `http://127.0.0.1:${mockPort}/v1/chat/completions`,
      IAI_CHAT_HEARTBEAT_MS: '1000',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(() => bridge.kill('SIGKILL'));
  await waitForLine(bridge, /IAI local audio bridge listening/);

  const response = await fetch(`http://127.0.0.1:${bridgePort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:3000',
      Authorization: 'Bearer test-valid-key',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'Furen-std',
      messages: [{ role: 'user', content: '整理重點' }],
    }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/x-ndjson/);
  const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(events.filter((event) => event.type === 'progress').length >= 2);
  assert.ok(events.some((event) => event.type === 'result' && event.payload?.choices));
});

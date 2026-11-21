import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverNotesLayout } from '../lib/notes-recovery.ts';
import {
  summarizeStudyTranscriptResilient,
  recoveryExport,
} from '../lib/study-resilient.ts';
import {
  assertReadableNotes,
  assertNotesMath,
  buildMarkdown,
  splitTranscript,
} from '../lib/iai-workflow.ts';
import { encodeCheckpoint, decodeCheckpoint } from '../lib/study-checkpoint.ts';

const cache = () => ({ signature: 'test', drafts: [], parts: [], merges: {} });
test('no discernible study content does not spend tokens on a second identical generation', async () => {
  const stored = cache();
  let calls = 0;
  await summarizeStudyTranscriptResilient(
    '下課閒聊',
    async () => {
      calls++;
      return '本段錄音沒有足夠的可辨識學習內容。';
    },
    stored,
  );
  await summarizeStudyTranscriptResilient(
    '下課閒聊',
    async () => {
      calls++;
      return '本段錄音沒有足夠的可辨識學習內容。';
    },
    stored,
  );
  assert.equal(calls, 1);
});
test('one unsafe section cannot erase other useful sections and repeated resume is free', async () => {
  const stored = cache();
  let calls = 0;
  const chat = async () => {
    calls++;
    return '## 變壓器錯誤段\n磁鏈守恆 N1Φ=N2Φ。\n\n## 整流（Rectification）\n二極體具有單向導通特性。';
  };
  const notes = await summarizeStudyTranscriptResilient(
    '變壓器與整流',
    chat,
    stored,
  );
  assert.equal(stored.recovery.results['0'].status, 'partial');
  assert.match(notes, /單向導通/);
  assert.doesNotMatch(notes, /磁鏈守恆/);
  await summarizeStudyTranscriptResilient('變壓器與整流', chat, stored);
  assert.equal(calls, 2);
});
const source = () =>
  Array.from({ length: 600 }, (_, i) => `第${i}節二極體整流說明。`).join('\n');

test('reported unclosed math and code are repaired locally without inventing content', async () => {
  for (const value of [
    '## 電流\n$$\nI=V/R',
    '## 程式\n```python\nprint(2)',
    '## 電流\n$$\nI=V/R\n## 電壓\nV=IR。',
  ]) {
    const repaired = await recoverNotesLayout(value);
    assertReadableNotes(repaired.text);
    await assertNotesMath(repaired.text);
    assert.ok(repaired.repairs.length);
    assert.match(repaired.text, /I=V\/R|print\(2\)/);
  }
});

test('invalid formulas become literal expressions; correct formulas and code remain unchanged', async () => {
  const input =
    '## 公式\n$\\unknownMacro{x}$ 與 $\\frac{x}{y}$\n```python\nprint("$PATH")\n```';
  const result = await recoverNotesLayout(input);
  await assertNotesMath(result.text);
  assert.match(result.text, /` \\unknownMacro\{x\} `/);
  assert.match(result.text, /\$\\frac\{x\}\{y\}\$/);
  assert.match(result.text, /print\("\$PATH"\)/);
});

test('format-only failures consume one call; clicking resume consumes ZERO additional calls', async () => {
  let calls = 0;
  const stored = cache();
  const chat = async () => {
    calls++;
    return '## 歐姆定律\n$$\nI=V/R';
  };
  const first = await summarizeStudyTranscriptResilient(
    '歐姆定律',
    chat,
    stored,
  );
  const second = await summarizeStudyTranscriptResilient(
    '歐姆定律',
    chat,
    stored,
  );
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.match(first, /補齊公式/);
  assert.equal(stored.recovery.complete, 1);
  assertReadableNotes(
    buildMarkdown({
      filename: '課程.m4a',
      transcript: '歐姆定律',
      notes: first,
      generatedAt: 'test',
    }),
  );
});

test('network interruption retains completed segments and resumes only missing segment', async () => {
  const raw = source();
  const total = splitTranscript(raw).length;
  const stored = cache();
  let calls = 0;
  await assert.rejects(
    summarizeStudyTranscriptResilient(
      raw,
      async () => {
        calls++;
        if (calls === 2) throw new Error('HTTP 524');
        return '## 整流\n二極體具有單向導通特性。';
      },
      stored,
    ),
    /524/,
  );
  const partial = recoveryExport(stored);
  assert.match(partial, /部分結果/);
  assert.match(partial, /第 2 段：尚未完成/);
  const before = calls;
  const complete = await summarizeStudyTranscriptResilient(
    raw,
    async () => {
      calls++;
      return '## 整流\n二極體具有單向導通特性。';
    },
    stored,
  );
  assert.equal(calls - before, total - 1);
  assert.equal(stored.recovery.complete, total);
  assert.match(complete, /所有分段已生成/);
});

test('repeated semantic errors are capped across retries and unsafe material is not exported', async () => {
  const stored = cache();
  let calls = 0;
  const chat = async () => {
    calls++;
    return '## 變壓器\n磁鏈守恆 N1Φ=N2Φ。';
  };
  const first = await summarizeStudyTranscriptResilient('變壓器', chat, stored);
  await summarizeStudyTranscriptResilient('變壓器', chat, stored);
  assert.equal(calls, 2);
  assert.equal(stored.recovery.complete, 0);
  assert.match(first, /目前尚無可用/);
  assert.doesNotMatch(first, /磁鏈守恆/);
});

test('truncation is visibly partial and remains partial after serialized cache recovery', async () => {
  const stored = cache();
  let calls = 0;
  const result = await summarizeStudyTranscriptResilient(
    '整流',
    async () => {
      calls++;
      throw Object.assign(new Error('length'), {
        partialContent: '## 整流\n二極體導通。\n$$\nI=V/R',
      });
    },
    stored,
  );
  assert.match(result, /尚未完整生成/);
  const restored = JSON.parse(JSON.stringify(stored));
  await summarizeStudyTranscriptResilient(
    '整流',
    async () => {
      calls++;
      throw new Error('must not call');
    },
    restored,
  );
  assert.equal(calls, 1);
  assert.equal(restored.recovery.complete, 0);
});

test('persist response before validation; resume after local conversion failure reuses it', async () => {
  const stored = cache();
  let checkpoints = 0;
  await summarizeStudyTranscriptResilient(
    '整流',
    async () => '## 整流\n二極體導通。',
    stored,
    {
      onCheckpoint: () => {
        checkpoints++;
        assert.ok(stored.recovery.responses['0'].length);
      },
    },
  );
  assert.ok(checkpoints >= 2);
});

test('checkpoint whitelist excludes API credentials and survives a refresh', () => {
  const job = {
    version: 1,
    savedAt: Date.now(),
    filename: '課程.m4a',
    model: 'Furen-std',
    mode: 'summary',
    preference: '',
    raw: '原始逐字稿',
    transcript: '校正逐字稿',
    correction: null,
    summary: cache(),
    apiKey: 'sk-secret-placeholder',
    headers: { Authorization: 'Bearer secret' },
  };
  const encoded = encodeCheckpoint(job);
  assert.doesNotMatch(encoded, /sk-secret|Bearer|apiKey|Authorization/);
  assert.equal(decodeCheckpoint(encoded).raw, '原始逐字稿');
  assert.throws(
    () =>
      decodeCheckpoint(
        JSON.stringify({ ...job, savedAt: Date.now() - 8 * 86400000 }),
      ),
    /七天/,
  );
  assert.throws(
    () => decodeCheckpoint(JSON.stringify({ ...job, raw: undefined })),
    /無效/,
  );
});

test('long lectures use one bounded source-only call per segment, no draft review or full merge', async () => {
  const raw = source();
  const stored = cache();
  let calls = 0;
  await summarizeStudyTranscriptResilient(
    raw,
    async (messages) => {
      calls++;
      const data = JSON.parse(
        messages[1].content.slice(messages[1].content.indexOf('{')),
      );
      assert.ok(data.source.length <= 2800);
      assert.equal(data.draft, '');
      assert.equal(data.corrected, undefined);
      return '## 整流\n二極體單向導通。';
    },
    stored,
  );
  assert.equal(calls, splitTranscript(raw).length);
});

test('quota and auth failures pause without automatic repeated generation, export status remains available', async () => {
  for (const message of ['budget_exceeded', 'HTTP 401', 'HTTP 503']) {
    const stored = cache();
    let calls = 0;
    await assert.rejects(
      summarizeStudyTranscriptResilient(
        '課程',
        async () => {
          calls++;
          throw new Error(message);
        },
        stored,
      ),
      new RegExp(message),
    );
    assert.equal(calls, 1);
    assert.match(recoveryExport(stored), /目前尚無可用/);
  }
});

test('empty provider output does not enter an unlimited retry loop', async () => {
  const stored = cache();
  let calls = 0;
  const chat = async () => {
    calls++;
    throw Object.assign(new Error('empty'), { contentUnusable: true });
  };
  await summarizeStudyTranscriptResilient('課程', chat, stored);
  await summarizeStudyTranscriptResilient('課程', chat, stored);
  assert.equal(calls, 1);
});

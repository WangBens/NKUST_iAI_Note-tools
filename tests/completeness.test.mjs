import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeCompleteStudyNotes as summarizeProduction,
  composeCompleteNotes,
  COMPLETE_VERSION,
} from '../lib/study-complete.ts';
const summarizeCompleteStudyNotes = (text, chat, cache, options = {}) =>
  summarizeProduction(text, chat, cache, { ...options, readerReview: false });
import {
  parseLearningReceipt,
  validateEducationalContent,
  sourceTopics,
  cleanLearningBody,
} from '../lib/learning-content.ts';
import {
  buildMarkdown,
  assertReadableNotes,
  assertNotesMath,
  splitTranscript,
} from '../lib/iai-workflow.ts';
import { encodeCheckpoint, decodeCheckpoint } from '../lib/study-checkpoint.ts';
import {
  STUDY_REFERENCES,
  sourceChargingExample,
} from '../lib/study-reference.ts';
const cache = () => ({ signature: 'test', drafts: [], parts: [], merges: {} });
const raw =
  '老師說明二極體的順向導通與逆向截止條件，並比較理想模型及固定順向壓降模型。';
const body =
  '二極體（Diode）具有單向導通特性。理想模型導通時壓降為零；固定順向壓降模型在導通時用 Vγ 表示壓降，必須先區分訊源電壓與元件兩端電壓。';
const receipt = (source = raw, text = body) =>
  JSON.stringify({
    kind: 'study',
    sections: [
      {
        topicId: 'diode',
        title: '二極體（Diode）',
        evidence: source,
        body: text,
      },
    ],
  });
test('provider newlines and LaTeX JSON escapes are repaired locally without deleting formulas', () => {
  const broken = receipt(raw, body + '\n\\[\\frac{x}{y}\\]');
  const literal = broken
    .replace('\\n\\\\[', '\n\\[')
    .replace('\\\\frac', '\\frac')
    .replace('\\\\]', '\\]');
  const parsed = parseLearningReceipt(literal);
  assert.match(parsed.sections[0].body, /\\frac\{x\}\{y\}/);
});
test('word source does not become an RC-filter topic, and 電池轉換 is not a charging circuit', () => {
  assert.ok(
    !sourceTopics('the source is unrelated', '').some(
      (r) => r.id === 'capacitor',
    ),
  );
  assert.ok(
    !sourceTopics('電池轉換與變壓器', '').some((r) => r.id === 'battery'),
  );
});
test('production uses corrected text and lexical context instead of paying then ignoring it', async () => {
  let calls = 0;
  const c = cache();
  const notes = await summarizeCompleteStudyNotes(
    raw,
    async (messages) => {
      calls++;
      const data = JSON.parse(
        messages[1].content.slice(messages[1].content.indexOf('{')),
      );
      assert.equal(data.corrected, '使用者模型校正的二極體文字');
      assert.equal(data.terminology, '二機體 → 二極體');
      assert.equal(data.raw, raw);
      return receipt();
    },
    c,
    {
      rawText: raw,
      correctedParts: ['使用者模型校正的二極體文字'],
      terminology: '二機體 → 二極體',
    },
  );
  assert.equal(calls, 1);
  assert.equal(c.recovery.complete, 1);
  assert.match(notes, /全部 1\/1/);
});
test('completed topic receipts remain cached and second run makes zero new calls', async () => {
  const c = cache();
  let calls = 0;
  const chat = async () => {
    calls++;
    return receipt();
  };
  const first = await summarizeCompleteStudyNotes(raw, chat, c);
  const second = await summarizeCompleteStudyNotes(raw, chat, c);
  assert.equal(first, second);
  assert.equal(calls, 1);
});
test('old partial/unavailable status is not a permanent skip', async () => {
  const c = cache();
  c.recovery = {
    version: '2026-10-11-recover-v1',
    responses: { 0: ['failed'] },
    results: { 0: { note: '', status: 'unavailable', repairs: [] } },
    total: 1,
    complete: 0,
    pending: [1],
  };
  let calls = 0;
  await summarizeCompleteStudyNotes(
    raw,
    async () => {
      calls++;
      return receipt();
    },
    c,
  );
  assert.equal(calls, 1);
  assert.equal(c.recovery.complete, 1);
  assert.equal(c.recovery.version, COMPLETE_VERSION);
  assert.equal(c.recovery.responses['0'][0], 'failed');
});
test('an actual nonteaching segment is processed, not misreported as unfinished', async () => {
  const source = '請大家先休息一下，下一節再繼續上課。';
  const c = cache();
  const notes = await summarizeCompleteStudyNotes(
    source,
    async () =>
      JSON.stringify({
        kind: 'nonstudy',
        category: 'administration',
        evidence: source,
        reason: '課間休息',
        sections: [],
      }),
    c,
  );
  assert.equal(c.recovery.complete, 1);
  assert.equal(c.recovery.nonstudy, 1);
  assert.deepEqual(c.recovery.pending, []);
  assert.match(notes, /非教學內容已辨識略過/);
  assert.doesNotMatch(notes, /尚有.*需要補齊/);
});
test('model cannot label a recognizably educational segment as nonteaching', async () => {
  const c = cache();
  let calls = 0;
  await summarizeCompleteStudyNotes(
    raw,
    async () => {
      calls++;
      return calls === 1
        ? JSON.stringify({
            kind: 'nonstudy',
            category: 'chitchat',
            evidence: raw,
            sections: [],
          })
        : receipt();
    },
    c,
  );
  assert.equal(calls, 2);
  assert.equal(c.recovery.complete, 1);
});
test('scoped checks allow valid source thresholds while rejecting known user-export errors', () => {
  assert.doesNotThrow(() =>
    validateEducationalContent('不能以磁鏈守恆直接推導變壓器電流比。'),
  );
  assert.throws(
    () => validateEducationalContent('變壓器電流比由磁鏈守恆推導。'),
    /不代表/,
  );
  assert.throws(
    () => validateEducationalContent('充電電路：$v_D > V_B + V_R$'),
    /訊源/,
  );
  assert.doesNotThrow(() =>
    validateEducationalContent('充電電路：$v_s > V_B + V_R$'),
  );
  assert.throws(
    () => validateEducationalContent('半波整流含電容濾波。PIV = $V_m-V_D$。'),
    /2Vm/,
  );
  assert.doesNotThrow(() =>
    validateEducationalContent('半波整流含電容濾波。PIV = $2V_m-V_D$。'),
  );
  assert.doesNotThrow(() =>
    validateEducationalContent(
      '中心抽頭 PIV 為兩倍峰值；充電導通門檻為 Vs+VR。',
    ),
  );
});
test('evidence and source-topic coverage are checked instead of only Markdown syntax', async () => {
  const c = cache();
  let calls = 0;
  await summarizeCompleteStudyNotes(
    raw,
    async () => {
      calls++;
      return calls === 1
        ? receipt('完全不在來源的虛構敘述', '已知條件：' + body)
        : receipt();
    },
    c,
  );
  assert.equal(calls, 2);
  assert.equal(c.recovery.complete, 1);
  assert.ok(
    sourceTopics('正合微分方程', '勢函數').some((r) => r.id === 'exact'),
  );
});
test('format delimiters repair locally with zero additional model calls', async () => {
  const c = cache();
  let calls = 0;
  const result = await summarizeCompleteStudyNotes(
    raw,
    async () => {
      calls++;
      return receipt(raw, body + '\n\n$$\nI=V/R');
    },
    c,
  );
  assert.equal(calls, 1);
  assertReadableNotes(result);
  await assertNotesMath(result);
});
test('invalid formula gets a bounded targeted repair, not exported as a correct formula', async () => {
  const c = cache();
  let calls = 0;
  await summarizeCompleteStudyNotes(
    raw,
    async () => {
      calls++;
      return receipt(
        raw,
        body + (calls === 1 ? '\n$\\unknownMacro{x}$' : '\n$I=V/R$'),
      );
    },
    c,
  );
  assert.equal(calls, 2);
  assert.equal(c.recovery.complete, 1);
});
test('manual completion repairs missing part without regenerating a completed source segment', async () => {
  const source = Array.from(
    { length: 350 },
    (_, i) => `第${i}段二極體導通與截止條件。`,
  ).join('\n');
  const chunks = splitTranscript(source);
  const c = cache();
  let fail = true,
    calls = 0;
  const chat = async (messages) => {
    calls++;
    const d = JSON.parse(
      messages[1].content.slice(messages[1].content.indexOf('{')),
    );
    if (d.segment === 2 && fail) return '{bad JSON';
    return receipt(d.raw);
  };
  await summarizeCompleteStudyNotes(source, chat, c);
  assert.equal(c.recovery.results['0'].status, 'complete');
  assert.ok(c.recovery.pending.length);
  const before = calls;
  fail = false;
  await summarizeCompleteStudyNotes(source, chat, c, { manualResume: true });
  assert.deepEqual(c.recovery.pending, []);
  assert.equal(calls - before, 1);
});
test('auth or quota interruption does not silently turn into a completed nonteaching result', async () => {
  const c = cache();
  let calls = 0;
  await assert.rejects(
    summarizeCompleteStudyNotes(
      raw,
      async () => {
        calls++;
        throw new Error('budget_exceeded');
      },
      c,
    ),
    /budget/,
  );
  assert.equal(calls, 1);
  assert.equal(c.recovery.complete, 0);
});
test('topic grouping preserves fenced code and math, even repeated delimiters', async () => {
  const c = cache();
  c.recovery = {
    version: COMPLETE_VERSION,
    responses: {},
    results: {
      0: {
        note: body,
        status: 'complete',
        repairs: [],
        sections: [
          {
            topicId: 'diode',
            title: '二極體（Diode）',
            body: body + '\n\n```python\nprint(2)\n```\n\n$$\nx=1\n$$',
          },
        ],
      },
      1: {
        note: body,
        status: 'complete',
        repairs: [],
        sections: [
          {
            topicId: 'diode',
            title: '二極體（Diode）',
            body: body + '\n\n```python\nprint(3)\n```\n\n$$\ny=2\n$$',
          },
        ],
      },
    },
    total: 2,
    complete: 2,
    pending: [],
  };
  const notes = composeCompleteNotes(c);
  assertReadableNotes(notes);
  await assertNotesMath(notes);
  assert.match(notes, /print\(2\)/);
  assert.match(notes, /print\(3\)/);
});
test('complete checkpoints preserve status, source and paid work, never API credentials', async () => {
  const c = cache();
  await summarizeCompleteStudyNotes(raw, async () => receipt(), c);
  const job = {
    version: 1,
    savedAt: Date.now(),
    filename: '課程.mp3',
    model: 'Furen-large',
    mode: 'summary',
    preference: '',
    raw,
    transcript: raw,
    correction: null,
    summary: c,
    apiKey: 'sk-private-sample',
  };
  const encoded = encodeCheckpoint(job);
  assert.doesNotMatch(encoded, /sk-private-sample/);
  const restored = decodeCheckpoint(encoded);
  let calls = 0;
  await summarizeCompleteStudyNotes(
    raw,
    async () => {
      calls++;
      throw new Error('must not call');
    },
    restored.summary,
  );
  assert.equal(calls, 0);
});
test('production final reader uses source, checkpoints approved groups and zero-call resume', async () => {
  const c = cache();
  let calls = 0;
  const chat = async (messages) => {
    calls++;
    return messages[0].content.includes('最終讀者版')
      ? '## 二極體模型（Diode Model）\n\n' + body
      : receipt();
  };
  const notes = await summarizeProduction(raw, chat, c);
  assert.equal(calls, 1);
  assert.equal(c.recovery.reader.ready, true);
  assert.match(notes, /讀者版 1\/1/);
  assert.match(notes, /固定順向壓降模型/);
  await summarizeProduction(raw, chat, c);
  assert.equal(calls, 1);
  const restored = decodeCheckpoint(
    encodeCheckpoint({
      version: 1,
      savedAt: Date.now(),
      filename: '課程.mp3',
      model: 'Furen-large',
      mode: 'summary',
      preference: '',
      raw,
      transcript: raw,
      correction: null,
      summary: c,
    }),
  );
  assert.equal(restored.summary.recovery.reader.ready, true);
});
test('reader failure cannot mark a completed root draft as a finished lecture; manual retry recovers only reader', async () => {
  const c = cache();
  let calls = 0,
    fail = true;
  const unknown = '老師說明鏈結串列的節點、指標與循序走訪。';
  const unknownBody =
    '鏈結串列（Linked List）由節點及連結構成，每個節點儲存資料及指向下一節點的參考。走訪時由起點逐一讀取節點，直到下一個參考為空，不能任意跳過中間節點。';
  const chat = async (messages) => {
    calls++;
    return messages[0].content.includes('最終讀者版')
      ? fail
        ? '磁鏈守恆推導電流比。'
        : unknownBody
      : JSON.stringify({
          kind: 'study',
          sections: [
            {
              topicId: 'linked-list',
              title: '鏈結串列（Linked List）',
              evidence: unknown,
              body: unknownBody,
            },
          ],
        });
  };
  await assert.rejects(summarizeProduction(unknown, chat, c), /校核尚未完成/);
  assert.equal(calls, 3);
  assert.equal(c.recovery.reader.ready, false);
  assert.match(composeCompleteNotes(c), /待校核/);
  fail = false;
  await summarizeProduction(unknown, chat, c, { manualResume: true });
  assert.equal(calls, 4);
  assert.equal(c.recovery.reader.ready, true);
});
test('double-escaped math delimiters normalize without modifying inline or fenced programs', async () => {
  const result = await cleanLearningBody(
    '公式：\\\\[I=V/R\\\\]\n`二機體 \\\\[x\\\\]`\n```js\nconst x="二機體";\n```',
  );
  assert.match(result.text, /\$\$\nI=V\/R\n\$\$/);
  assert.match(result.text, /`二機體/);
  assert.match(result.text, /const x="二機體"/);
  await assertNotesMath(result.text);
});
test('reviewed models render, keep topology-specific PIV and accept only a complete source numerical case', async () => {
  for (const text of Object.values(STUDY_REFERENCES)) {
    const cleaned = await cleanLearningBody(text);
    validateEducationalContent(cleaned.text);
    await assertNotesMath(cleaned.text);
  }
  const source =
    '假設一個蓄電池12V，限流電阻100歐姆，一顆二極體導通電壓0.6，正弦波是24V。訊源要克服電池與二極體壓降。';
  const example = sourceChargingExample(source);
  assert.match(example, /114/);
  assert.match(example, /36/);
  assert.match(example, /32\.4/);
  await assertNotesMath(example);
  assert.equal(
    sourceChargingExample('電池12V，另頁100歐姆與24V，不知角色。'),
    '',
  );
  assert.equal(
    sourceChargingExample('蓄電池12V，限流電阻100歐姆，訊源要克服電池。'),
    '',
  );
});

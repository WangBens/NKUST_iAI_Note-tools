import test from 'node:test';
import { toTraditionalStudyText } from '../lib/study-text.ts';
import assert from 'node:assert/strict';
import {
  correctionMessages,
  correctStudyTranscript,
  summarizeStudyTranscript,
  summarySignature,
  NOTES_REVIEW_SYSTEM_PROMPT,
  STUDY_PROMPT_VERSION,
  TERMINOLOGY_SYSTEM_PROMPT,
  compactTerminology,
  assertStudyNotesContent,
} from '../lib/study-notes.ts';
import {
  assertCompleteChatResponse,
  assertReadableNotes,
  buildMarkdown,
  extractChatContent,
  stripMarkdownFence,
  normalizeNotesMarkdown,
  extractErrorMessage,
  assertNotesMath,
} from '../lib/iai-workflow.ts';

function data(messages) {
  return JSON.parse(
    messages[1].content.slice(messages[1].content.indexOf('{')),
  );
}

test('correction has bounded adjacent context and outputs only the selected source', async () => {
  const chunks = ['前段'.repeat(250), 'y prime 等於 2x。', '後段'.repeat(250)];
  const input = data(correctionMessages(chunks, 1));
  assert.equal(input.source, chunks[1]);
  assert.equal(input.contextBefore.length, 400);
  assert.equal(input.contextAfter.length, 400);
  const cache = { signature: 'test', parts: [] };
  const result = await correctStudyTranscript(
    'y prime 等於 2x。',
    async (messages) =>
      messages[0].content === TERMINOLOGY_SYSTEM_PROMPT
        ? '微分：Derivative'
        : data(messages).source,
    cache,
  );
  assert.equal(result, 'y prime 等於 2x。');
  assert.equal(cache.terminology, '');
});

test('merge review keeps original evidence rather than promoting generated notes to source', async () => {
  const raw = '正合微分方程的原始條件。'.repeat(300);
  const cache = { signature: 'test', drafts: [], parts: [], merges: {} };
  let finalSource;
  const chat = async (messages) => {
    const payload = data(messages);
    if (
      messages[0].content.includes(NOTES_REVIEW_SYSTEM_PROMPT) &&
      payload.source.length > 2800
    )
      finalSource = payload.source;
    return '## 正合微分方程\n\n存在勢函數（Potential Function）。';
  };
  await summarizeStudyTranscript(raw, chat, cache, { rawText: raw });
  assert.match(finalSource, /原始條件/);
  assert.doesNotMatch(finalSource, /存在勢函數/);
});

test('escaped LaTeX commands are repaired only inside math, never in programs', () => {
  const input =
    '## 公式\n$\\\\frac{x}{y}$\n\n$$\n\\\\partial_x f=2x\\\\,y\n\\\\begin{aligned}a&=b \\\\ c&=d\\\\end{aligned}\n$$\n\n```python\npath = "C:\\\\Users"\n```';
  const normalized = normalizeNotesMarkdown(input);
  assert.match(normalized, /\$\\frac\{x\}\{y\}\$/);
  assert.match(normalized, /\\partial_x/);
  assert.match(normalized, /b \\\\ c/);
  assert.match(normalized, /C:\\\\Users/);
});

test('glossary accepts short word mappings but excludes guessed example equations', () => {
  const glossary = compactTerminology(
    '- 政核 → 正合方程（Exact Differential Equation）\n- 解碼 → M = 3x²y\n- 噪音 → 無法辨識，不列入',
  );
  assert.match(glossary, /Exact Differential Equation/);
  assert.doesNotMatch(glossary, /3x|噪音/);
});

test('literal layout escapes normalize without changing math commands or program strings', () => {
  const source =
    '## 公式\\n\\n$$\\n\\nu=1\\n$$\n\n```python\nprint("\\n")\n```';
  const normalized = normalizeNotesMarkdown(source);
  assert.match(normalized, /## 公式\n\n\$\$\n\\nu=1\n\$\$/);
  assert.match(normalized, /print\("\\n"\)/);
  const scope = normalizeNotesMarkdown(
    '## 已學概念\n可靠內容。\n- 本段未涉及其他方法。\n\n```python\nprint("本段未涉及其他方法")\n```',
  );
  assert.doesNotMatch(scope, /- 本段未涉及/);
  assert.match(scope, /print\("本段未涉及其他方法"\)/);
});

test('provider error messages cannot echo API credentials into the UI', () => {
  const message = extractErrorMessage(
    '{"error":{"message":"invalid key sk-test-placeholder-123456 and Bearer another-private-token"}}',
    'failed',
  );
  assert.doesNotMatch(message, /sk-test|another-private-token/);
  assert.match(message, /已隱藏/);
});

test('unrenderable math is rejected while program dollar signs stay literal', async () => {
  await assertNotesMath(
    '## 公式\n$$\n\\frac{1}{2}\n$$\n\n```bash\necho "$PATH"\n```',
  );
  await assert.rejects(
    assertNotesMath('公式：$\\unknownCourseMacro{x}$'),
    /LaTeX/,
  );
  await assert.rejects(assertNotesMath('公式：$frac{x}{y}$'), /LaTeX/);
  await assert.rejects(assertNotesMath('公式：$\\\\\\ partial x$'), /LaTeX/);
  await assert.rejects(assertNotesMath('公式：$\n\\\\Phi(x,y)=C$'), /LaTeX/);
  await assertNotesMath('`$\\unknownMacro$` 是程式字串，不是數學公式。');
});

test('formula repair receives the exact rejected expression and parser diagnostic', async () => {
  let reviews = 0;
  const result = await summarizeStudyTranscript(
    '積分二x。',
    async (messages) => {
      if (!messages[0].content.includes(NOTES_REVIEW_SYSTEM_PROMPT))
        return '## 積分\n$\\unknownCourseMacro{x}$';
      reviews += 1;
      if (reviews === 1) return '## 積分\n$\\unknownCourseMacro{x}$';
      const feedback = JSON.parse(
        messages[2].content.slice(messages[2].content.indexOf('{')),
      );
      assert.equal(feedback.invalidFormula, '\\unknownCourseMacro{x}');
      assert.match(feedback.syntaxError, /unknownCourseMacro/);
      return '## 積分\n$\\int 2x\\,dx=x^2+C$';
    },
    { signature: 'test', drafts: [], parts: [], merges: {} },
  );
  assert.equal(reviews, 2);
  assert.match(result, /x\^2/);
});

test('failed merge review reuses its complete draft on resume', async () => {
  const text = '微分概念說明。'.repeat(600);
  const cache = { signature: 'test', drafts: [], parts: [], merges: {} };
  let mergeCalls = 0;
  let failMergeReview = true;
  const chat = async (messages) => {
    const payload = data(messages);
    if (payload.parts) mergeCalls += 1;
    if (
      messages[0].content.includes(NOTES_REVIEW_SYSTEM_PROMPT) &&
      payload.source.length > 2800 &&
      failMergeReview
    )
      throw new Error('temporary provider failure');
    return '## 微分\n導數表示瞬時變化率。';
  };
  await assert.rejects(summarizeStudyTranscript(text, chat, cache));
  assert.equal(mergeCalls, 1);
  assert.equal(Object.keys(cache.mergeDrafts).length, 1);
  failMergeReview = false;
  await summarizeStudyTranscript(text, chat, cache);
  assert.equal(mergeCalls, 1);
});

test('long lecture reader review stays source-bounded and never copies a poisoned draft', async () => {
  const raw = Array.from(
    { length: 800 },
    (_, index) => `第${index}段二極體正半週整流與電容濾波。`,
  ).join('\n');
  const cache = { signature: 'test', drafts: [], parts: [], merges: {} };
  let readerCalls = 0;
  await summarizeStudyTranscript(
    raw,
    async (messages) => {
      const payload = data(messages);
      assert.ok(!payload.parts, 'must not request a whole-lecture merge');
      if (messages[0].content.startsWith('這是最終讀者版')) {
        readerCalls += 1;
        assert.ok(payload.source.length <= 2800);
        assert.equal(payload.draft, '');
        assert.equal(payload.corrected, undefined);
      }
      return '## 整流與濾波\n\n二極體整流，電容平滑輸出。';
    },
    cache,
    { rawText: raw },
  );
  assert.ok(readerCalls > 1);
  assert.equal(Object.keys(cache.readerParts).length, readerCalls);
});

test('truncated correction splits into smaller pieces and preserves text', async () => {
  const text = Array.from(
    { length: 120 },
    (_, index) => `第${index}題的微分課程說明。`,
  ).join('');
  const cache = { signature: 'test', parts: [], terminology: '' };
  let truncated = 0;
  const result = await correctStudyTranscript(
    text,
    async (messages) => {
      const source = data(messages).source;
      if (source.length > 1000) {
        truncated += 1;
        throw new Error('LLM 輸出達到長度上限，內容未完整產生');
      }
      return source;
    },
    cache,
  );
  assert.ok(truncated > 0);
  assert.equal(result.replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.equal(cache.parts.length, 1);
  assert.ok(Object.keys(cache.subparts).length > 1);
});

test('unconfirmed details trigger a bounded repair rather than a successful export', async () => {
  const cache = { signature: 'test', drafts: [], parts: [], merges: {} };
  let reviews = 0;
  const result = await summarizeStudyTranscript(
    '微分定義。',
    async (messages) => {
      if (!messages[0].content.includes(NOTES_REVIEW_SYSTEM_PROMPT))
        return '## 微分\n待確認';
      reviews += 1;
      return reviews === 1
        ? '## 微分\n待確認'
        : '## 微分\n導數表示瞬時變化率。';
    },
    cache,
    { filename: '工程數學.m4a' },
  );
  assert.equal(reviews, 2);
  assert.doesNotMatch(result, /待確認/);
  await assert.rejects(
    summarizeStudyTranscript(
      '雜音',
      async () => '本段錄音沒有足夠的可辨識學習內容。',
      { signature: 'test', drafts: [], parts: [], merges: {} },
    ),
    /未產生可靠學習重點/,
  );
});

test('Traditional Chinese conversion keeps English, LaTeX and source programs unchanged', async () => {
  assert.equal(
    await toTraditionalStudyText('请执行 `变量 = "输入"`。'),
    '請執行 `变量 = "输入"`。',
  );
  const result = await toTraditionalStudyText(
    '输入电压与输出电流，Bridge Rectifier。\n$\\frac{x}{y}$\n\n```python\n变量 = "输入电压"\n```',
  );
  assert.match(result, /輸入電壓與輸出電流/);
  assert.match(result, /Bridge Rectifier/);
  assert.match(result, /\\frac\{x\}\{y\}/);
  assert.match(result, /变量 = "输入电压"/);
});

test('source review replaces an incorrect draft and retry reuses the completed draft', async () => {
  const cache = { signature: 'test', drafts: [], parts: [], merges: {} };
  let calls = 0;
  let reviewFails = true;
  const chat = async (messages) => {
    calls += 1;
    if (!messages[0].content.includes(NOTES_REVIEW_SYSTEM_PROMPT))
      return '## 積分\n\n$$\n\\int 2x\\,dx=x^3+C\n$$';
    assert.equal(data(messages).source, '積分二x dx等於x平方加C。');
    if (reviewFails) throw new Error('provider temporarily unavailable');
    return '## 積分\n\n$$\n\\int 2x\\,dx=x^2+C\n$$';
  };
  const options = {
    rawText: '積分二x dx等於x平方加C。',
    correctedParts: ['積分 2x dx 等於 x²+C。'],
  };
  await assert.rejects(
    summarizeStudyTranscript('積分 2x dx 等於 x²+C。', chat, cache, options),
  );
  assert.equal(cache.drafts.length, 1);
  assert.equal(cache.parts.length, 0);
  reviewFails = false;
  const result = await summarizeStudyTranscript(
    '積分 2x dx 等於 x²+C。',
    chat,
    cache,
    options,
  );
  assert.match(result, /x\^2/);
  assert.doesNotMatch(result, /x\^3/);
  assert.equal(calls, 3);
  assert.equal(cache.parts.length, 1);
});

test('cache signature changes for middle-of-source edits and prompt version', () => {
  const a = summarySignature('corrected', 'head OLD tail', 'Furen-std', '');
  const b = summarySignature('corrected', 'head NEW tail', 'Furen-std', '');
  assert.notEqual(a, b);
  assert.match(a, new RegExp(STUDY_PROMPT_VERSION));
});

test('global exactness criterion cannot omit its differentiability and domain assumptions', () => {
  assert.throws(
    () => assertStudyNotesContent('中心抽頭整流每顆 PIV = $V_m + V_D$。'),
    /不能寫成/,
  );
  assert.throws(() => assertStudyNotesContent('磁鏈守恆 N1Φ=N2Φ。'), /不能用/);
  assert.throws(
    () => assertStudyNotesContent('潛函數的定義。'),
    /Potential Function/,
  );
  assert.doesNotThrow(() =>
    assertStudyNotesContent('勢函數（Potential Function）的偏導對應係數。'),
  );
  assert.throws(
    () => assertStudyNotesContent('完全微分方程：偏導相等即可判別。'),
    /必要前提/,
  );
  assert.doesNotThrow(() =>
    assertStudyNotesContent(
      '完全微分方程：M、N 在開單連通區域上具有連續的一階偏導數，偏導相等即可判別。',
    ),
  );
  assert.doesNotThrow(() => assertStudyNotesContent('二極體整流與濾波。'));
});

test('reasoning-only and unfinished thinking output never become learning notes', () => {
  assert.equal(
    extractChatContent({
      choices: [
        { message: { content: '', reasoning_content: 'private analysis' } },
      ],
    }),
    '',
  );
  assert.equal(
    extractChatContent({
      choices: [{ message: { content: '<think>unfinished analysis' } }],
    }),
    '',
  );
  assert.equal(
    extractChatContent({
      choices: [
        { message: { content: '<think>analysis</think>## 正文\n內容' } },
      ],
    }),
    '## 正文\n內容',
  );
});

test('truncated and filtered model responses cannot be exported as complete notes', () => {
  assert.throws(
    () =>
      assertCompleteChatResponse({ choices: [{ finish_reason: 'length' }] }),
    /長度上限/,
  );
  assert.throws(
    () =>
      assertCompleteChatResponse({
        choices: [{ finish_reason: 'content_filter' }],
      }),
    /未提供完整內容/,
  );
  assert.doesNotThrow(() =>
    assertCompleteChatResponse({ choices: [{ finish_reason: 'stop' }] }),
  );
});

test('Markdown keeps fenced programs intact and rejects unclosed math or code', () => {
  const code = '```python\n# a Python comment\nprint(2)\n```';
  assert.equal(stripMarkdownFence(code), code);
  assert.equal(
    stripMarkdownFence('```markdown\n## 概念\n內容\n```'),
    '## 概念\n內容',
  );
  const result = buildMarkdown({
    filename: 'lecture.m4a',
    transcript: '內容',
    notes: '# 主題\n\n' + code,
    generatedAt: '2026/10/7',
  });
  assert.match(result, /## 主題/);
  assert.match(result, /```python\n# a Python comment\nprint\(2\)\n```/);
  assert.throws(() => assertReadableNotes('## 公式\n$$\nx^2'), /未完整閉合/);
  assert.throws(() => assertReadableNotes('```python\nprint(2)'), /未完整閉合/);
  assert.doesNotThrow(() => assertReadableNotes('## 公式\n$$\nx^2\n$$'));
});

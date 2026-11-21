import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_FILE_BYTES,
  SUMMARY_CHUNK_CHARS,
  SUMMARY_MERGE_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  TRANSCRIPT_CORRECTION_SYSTEM_PROMPT,
  buildMarkdown,
  cleanTranscriptRepetition,
  extractChatContent,
  extractErrorMessage,
  extractTranscript,
  isBudgetExceededMessage,
  isModelLoadingMessage,
  isRetryableStatus,
  mergeTranscriptSegments,
  safeBaseName,
  splitTranscript,
  stripMetaRuleAnnouncements,
  validateAudioFile,
} from '../lib/iai-workflow.ts';

test('30 MB files are accepted and larger files are rejected', () => {
  assert.deepEqual(
    validateAudioFile({ name: 'lecture.m4a', size: MAX_FILE_BYTES }),
    { ok: true },
  );
  assert.equal(
    validateAudioFile({ name: 'lecture.mp3', size: MAX_FILE_BYTES + 1 }).ok,
    false,
  );
});

test('file validation rejects unsupported and empty files', () => {
  assert.equal(validateAudioFile({ name: 'notes.pdf', size: 20 }).ok, false);
  assert.equal(validateAudioFile({ name: 'empty.wav', size: 0 }).ok, false);
  assert.equal(validateAudioFile({ name: 'CLASS.MP3', size: 20 }).ok, true);
});

test('transcript extraction supports common IAI-compatible shapes', () => {
  assert.equal(extractTranscript({ text: '逐字稿' }), '逐字稿');
  assert.equal(extractTranscript({ data: { transcript: '內容' } }), '內容');
  assert.equal(
    extractTranscript({ segments: [{ text: '第一段' }, { text: '第二段' }] }),
    '第一段 第二段',
  );
});

test('chat extraction accepts arrays, strips markdown fences, and handles thinking tags', () => {
  assert.equal(
    extractChatContent({
      choices: [{ message: { content: '```markdown\n## 重點\n內容\n```' } }],
    }),
    '## 重點\n內容',
  );
  assert.equal(
    extractChatContent({
      choices: [{ message: { content: [{ text: 'A' }, { text: 'B' }] } }],
    }),
    'A\nB',
  );
  assert.equal(
    extractChatContent({
      choices: [
        {
          message: {
            content:
              '<think>Let me analyze this transcript...</think>\n\n校正後內容',
          },
        },
      ],
    }),
    '校正後內容',
  );
  assert.equal(
    extractChatContent({
      choices: [
        {
          message: {
            content: '',
            reasoning_content: '備用思考內容',
          },
        },
      ],
    }),
    '',
  );
});

test('long transcripts split without losing non-whitespace text', () => {
  const source = `${'第一句。'.repeat(9000)}\n${'第二句。'.repeat(9000)}`;
  const chunks = splitTranscript(source, 12_000);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 12_000));
  assert.equal(chunks.join('').replace(/\s/g, ''), source.replace(/\s/g, ''));
});

test('default LLM chunks keep a 50-minute transcript below proxy-timeout risk', () => {
  const source = '工程數學。'.repeat(903).slice(0, 5_419);
  const chunks = splitTranscript(source);
  assert.equal(SUMMARY_CHUNK_CHARS, 2_800);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length <= SUMMARY_CHUNK_CHARS));
  assert.equal(chunks.join('').replace(/\s/g, ''), source.replace(/\s/g, ''));
});

test('retry classification handles model loading and transient statuses', () => {
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(401), false);
  assert.equal(isModelLoadingMessage('Model is loading, please retry'), true);
  assert.equal(isModelLoadingMessage('API key invalid'), false);
});

test('budget exhaustion is detected separately from temporary rate limiting', () => {
  assert.equal(
    isBudgetExceededMessage(
      'ExceededBudget: User=C000000000 over budget. Spend=13.05, Budget=12.0',
    ),
    true,
  );
  assert.equal(isBudgetExceededMessage('{"type":"budget_exceeded"}'), true);
  assert.equal(
    isBudgetExceededMessage('Too many requests; retry later'),
    false,
  );
});

test('Cloudflare HTML errors are converted to a safe concise message', () => {
  const raw =
    '<!DOCTYPE html><html><head><title>example.com | 524: A timeout occurred</title></head></html>';
  const message = extractErrorMessage(raw, 'IAI 回傳錯誤');
  assert.match(message, /Cloudflare 524/);
  assert.doesNotMatch(message, /DOCTYPE|<html/i);
  const generic = extractErrorMessage(
    '<html>gateway failed</html>',
    'HTTP 502',
  );
  assert.equal(generic, 'HTTP 502（上游服務回傳網頁錯誤，已隱藏原始 HTML）');
});

test('learning notes contain only knowledge, never metadata or a legacy transcript appendix', () => {
  assert.equal(safeBaseName('課程:第一章?.m4a'), '課程_第一章_');
  const markdown = buildMarkdown({
    filename: '課程.m4a',
    transcript: '完整內容',
    notes: '## 重點\n測試',
    model: 'Furen-std',
    generatedAt: '2026/9/8',
  });
  assert.doesNotMatch(markdown, /Furen-std|來源檔案|產生時間/);
  assert.doesNotMatch(markdown, /完整內容/);
  const combined = buildMarkdown({
    filename: '課程.m4a',
    transcript: '完整內容',
    notes: '## 重點\n測試',
    generatedAt: '2026/10/7',
    includeTranscript: true,
  });
  assert.doesNotMatch(combined, /完整內容/);
});

test('LLM prompts require Traditional Chinese, English terms, typo correction, and explicit formulas/code', () => {
  assert.match(TRANSCRIPT_CORRECTION_SYSTEM_PROMPT, /繁體中文/);
  assert.match(TRANSCRIPT_CORRECTION_SYSTEM_PROMPT, /英文專有名詞/);
  assert.match(TRANSCRIPT_CORRECTION_SYSTEM_PROMPT, /直接修正.*錯字/);
  assert.match(TRANSCRIPT_CORRECTION_SYSTEM_PROMPT, /不得摘要、刪減/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /完整、詳細列出所有學習重點/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /公式與推導/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /程式與範例/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /不要加入「不確定或需確認之處」章節/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /無法確認的細節直接省略/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /未明確/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /定理證明/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /嚴禁輸出任何規則引用/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /條列式/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /不強迫每節加表格/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /禁止編造題目/);
  assert.match(SUMMARY_MERGE_SYSTEM_PROMPT, /不可遺漏任何可確定的分段知識點/);
  assert.match(SUMMARY_MERGE_SYSTEM_PROMPT, /不同前提、不同模型或不同例題/);
});

test('stripMetaRuleAnnouncements filters rogue LLM rule self-audit, omission declaration, and conclusion remarks', () => {
  const badOutput = [
    '## 課程重點',
    '✅ 根據規則：「根據上下文與你的領域知識直接修正殘留的語音辨識錯字、同音字與術語拼寫」，我們必須修正上述明顯錯誤。',
    '❌ 但不得加入「可能」「疑似」「不確定」等字樣，因此修正後直接使用正確術語，不註明來源。',
    '這是正常的學習筆記內容。',
    '',
    '## 四、程式與範例',
    '逐字稿中未提及任何程式碼、程式語言、演算法或程式相關內容。因此，根據規則 5，直接省略此類別，不加入任何程式碼或說明。',
    '',
    '# 結論',
    '此份學習筆記整理：',
    '- 完整統整了逐字稿中可辨識的核心觀念',
    '- 未虛構任何未提及的內容',
    '> ✅ 符合所有指示規則，忠於逐字稿內容，不添加推測。',
  ].join('\n');
  const cleaned = stripMetaRuleAnnouncements(badOutput);
  assert.match(cleaned, /## 課程重點/);
  assert.match(cleaned, /這是正常的學習筆記內容。/);
  assert.doesNotMatch(cleaned, /根據規則/);
  assert.doesNotMatch(cleaned, /但不得加入/);
  assert.doesNotMatch(cleaned, /程式與範例/);
  assert.doesNotMatch(cleaned, /# 結論/);
  assert.doesNotMatch(cleaned, /符合所有指示規則/);
});

test('transcript-only Markdown records the selected correction model', () => {
  const markdown = buildMarkdown({
    filename: 'lecture.m4a',
    transcript: '校正後逐字稿',
    model: 'Furen-large',
    generatedAt: '2026/9/11',
  });
  assert.match(markdown, /逐字稿校正模型：高科 iAI `Furen-large`/);
});

test('ASR degeneration cleanup collapses long character, word, and sentence loops', () => {
  const source = [
    `白魯${'鐵'.repeat(96)}最後保留`,
    '電子學'.repeat(40),
    '這一天就要做好'.repeat(31),
    '非常非常非常',
  ].join('\n');
  const cleaned = cleanTranscriptRepetition(source);
  assert.match(cleaned, /白魯鐵鐵最後保留/);
  assert.equal((cleaned.match(/電子學/g) ?? []).length, 1);
  assert.equal((cleaned.match(/這一天就要做好/g) ?? []).length, 1);
  assert.match(cleaned, /非常非常非常/);
});

test('segment merging removes exact boundary overlap and cleans each segment', () => {
  const merged = mergeTranscriptSegments([
    '第一段的結尾包含這一串共同文字',
    `包含這一串共同文字${'不要'.repeat(20)}，接著是第二段。`,
  ]);
  assert.equal((merged.match(/包含這一串共同文字/g) ?? []).length, 1);
  assert.equal((merged.match(/不要/g) ?? []).length, 1);
  assert.match(merged, /接著是第二段/);
});

test('markdown export applies repetition cleanup as a final safety net', () => {
  const markdown = buildMarkdown({
    filename: '退化錄音.m4a',
    transcript: `開始${'肺'.repeat(176)}結束`,
    generatedAt: '2026/9/9',
  });
  assert.match(markdown, /開始肺肺結束/);
  assert.doesNotMatch(markdown, /肺{4}/);
});

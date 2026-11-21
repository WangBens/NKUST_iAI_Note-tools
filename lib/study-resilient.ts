import {
  splitTranscript,
  cleanTranscriptRepetition,
  assertNotesMath,
  redactApiSecrets,
} from './iai-workflow.ts';
import { recoverNotesLayout } from './notes-recovery.ts';
import { toTraditionalStudyText } from './study-text.ts';
import { COMPLETE_VERSION, composeCompleteNotes } from './study-complete.ts';
import {
  reviewMessages,
  FINAL_READER_INSTRUCTION,
  assertStudyNotesContent,
  type StudyChat,
  type SummaryCache,
  type StudyProgress,
} from './study-notes.ts';

export const RESILIENT_VERSION = '2026-10-11-recover-v1';
export type SegmentResult = {
  note: string;
  repairs: string[];
  status: 'complete' | 'partial' | 'unavailable' | 'nonstudy';
  reason?: string;
  sections?: {
    topicId: string;
    title: string;
    body: string;
    unitIds?: string[];
  }[];
  audited?: boolean;
  reviewVersion?: string;
  unitIds?: string[];
  coverage?: { id: string; kind: 'study' | 'aside' | 'noise' }[];
  topics?: string[];
};
export type RecoveryState = {
  version: string;
  sourceKey?: string;
  legacy?: {
    version: string;
    responses: Record<string, string[]>;
    results: Record<string, SegmentResult>;
  };
  responses: Record<string, string[]>;
  results: Record<string, SegmentResult>;
  total: number;
  complete: number;
  pending: number[];
  truncated?: Record<string, boolean>;
  work?: Record<
    string,
    {
      responses: string[];
      filterResponses?: string[];
      reviewResponses?: string[];
      reviewVersion?: string;
      policyVersion?: string;
      units?: { id: string; text: string }[];
      truncated?: Record<string, boolean>;
      children?: boolean;
      result?: SegmentResult;
    }
  >;
  meaningful?: number;
  nonstudy?: number;
  coverage?: string[];
  reader?: {
    version: string;
    key: string;
    responses: Record<string, string[]>;
    parts: Record<string, string>;
    total: number;
    pending: number[];
    ready: boolean;
    topics: string[];
  };
};
export type ResilientCache = SummaryCache & { recovery?: RecoveryState };
const emptySegment = /^本段錄音沒有足夠的可辨識學習內容[。.]?$/;

function checkContent(note: string) {
  if (!note.trim() || emptySegment.test(note.trim()))
    throw new Error('此段沒有足夠的可辨識學習內容');
  assertStudyNotesContent(note);
  if (/未明確|待確認|疑似|不對！|這又不一致|\?\*\*不！|？\*\*不！/.test(note))
    throw new Error('此段仍有未校核或自我推翻的內容');
}

async function salvageSections(response: string): Promise<SegmentResult> {
  const repaired = await recoverNotesLayout(
    await toTraditionalStudyText(response),
  );
  const [{ unified }, { default: parse }, { default: math }, { default: gfm }] =
    await Promise.all([
      import('unified'),
      import('remark-parse'),
      import('remark-math'),
      import('remark-gfm'),
    ]);
  const tree = unified().use(parse).use(gfm).use(math).parse(repaired.text);
  // Markdown AST positions avoid treating headings inside a program as sections.
  const boundaries = [
    0,
    ...tree.children
      .filter((node) => node.type === 'heading')
      .map((node) => node.position?.start.offset ?? 0),
    repaired.text.length,
  ];
  const offsets = [...new Set(boundaries)].sort((a, b) => a - b);
  const valid: string[] = [];
  for (let index = 0; index < offsets.length - 1; index++) {
    const section = repaired.text
      .slice(offsets[index], offsets[index + 1])
      .trim();
    if (!section.replace(/^#{1,6}[^\n]*(?:\n|$)/, '').trim()) continue;
    try {
      checkContent(section);
      await assertNotesMath(section);
      valid.push(section);
    } catch {
      /* Do not export an invalid section or invent its replacement. */
    }
  }
  const note = valid.join('\n\n');
  if (note) {
    checkContent(note);
    await assertNotesMath(note);
  }
  return {
    note,
    repairs: repaired.repairs,
    status: note ? 'partial' : 'unavailable',
    reason: '部分章節未通過內容檢查，僅保留通過檢查的章節；不重新計費生成',
  };
}

export function recoveryExport(cache: ResilientCache) {
  const state = cache.recovery;
  if (!state) return '';
  if (state.version === COMPLETE_VERSION) return composeCompleteNotes(cache);
  const sections: string[] = [];
  const issues: string[] = [];
  for (let i = 0; i < state.total; i += 1) {
    const segment = state.results[String(i)];
    if (segment?.note)
      sections.push(`## 錄音第 ${i + 1} 段\n\n${segment.note}`);
    if (!segment || segment.status !== 'complete')
      issues.push(
        `第 ${i + 1} 段${segment?.status === 'partial' ? (segment.reason ? '：部分章節未通過檢查，已保留其餘內容' : '：僅保留已回傳內容，尚未完整生成') : '：尚未完成，未納入學習重點'}`,
      );
    if (segment?.repairs.length)
      issues.push(`第 ${i + 1} 段排版處理：${segment.repairs.join('；')}`);
  }
  const status =
    state.complete === state.total
      ? '所有分段已生成；不代表內容已經人工核對。'
      : `已完成 ${state.complete}/${state.total} 段；此為部分結果，不是完整講義。`;
  return `> 整理狀態：${status}\n\n${sections.length ? sections.join('\n\n---\n\n') : '## 整理狀態\n\n目前尚無可用的學習重點。請另存逐字稿及復原檔，待 API 恢復後續跑；系統未編造筆記。'}${issues.length ? '\n\n---\n\n## 匯出狀態與排版處理\n\n' + issues.map((s) => '- ' + s).join('\n') : ''}`;
}

export async function validateRecoveredNotes(cache: ResilientCache) {
  const state = cache.recovery;
  if (!state) return;
  for (const [key, result] of Object.entries(state.results)) {
    if (!result.note) continue;
    try {
      const recovered = await recoverNotesLayout(result.note);
      checkContent(recovered.text);
      await assertNotesMath(recovered.text);
      result.note = recovered.text;
      result.repairs = [...new Set([...result.repairs, ...recovered.repairs])];
    } catch {
      state.results[key] = {
        note: '',
        status: 'unavailable',
        repairs: [],
        reason: '復原內容未通過檢查，未納入學習重點',
      };
    }
  }
  state.complete = Object.values(state.results).filter(
    (s) => s.status === 'complete',
  ).length;
}

/** One source-grounded pass per segment, at most one semantic repair.
 * Every received response is checkpointed before local validation. Layout
 * faults cost no extra tokens; no expensive whole-lecture merge is needed.
 */
export async function summarizeStudyTranscriptResilient(
  text: string,
  chat: StudyChat,
  cache: ResilientCache,
  options: {
    rawText?: string;
    filename?: string;
    preference?: string;
    onProgress?: StudyProgress;
    onCheckpoint?: () => void;
    [key: string]: unknown;
  } = {},
) {
  const chunks = splitTranscript(
    cleanTranscriptRepetition(options.rawText || text),
  );
  if (!chunks.length) throw new Error('沒有逐字稿；無法憑空產生學習重點。');
  if (cache.recovery?.version !== RESILIENT_VERSION)
    cache.recovery = {
      version: RESILIENT_VERSION,
      responses: {},
      results: {},
      total: chunks.length,
      complete: 0,
      pending: [],
    };
  const state = cache.recovery;
  await validateRecoveredNotes(cache);
  state.total = chunks.length;
  const checkpoint = () => {
    state.complete = Object.values(state.results).filter(
      (s) => s.status === 'complete',
    ).length;
    state.pending = chunks
      .map((_, i) => i + 1)
      .filter((i) => state.results[String(i - 1)]?.status !== 'complete');
    options.onCheckpoint?.();
  };
  for (let index = 0; index < chunks.length; index += 1) {
    const key = String(index);
    if (state.results[key]) {
      if (
        state.results[key].status === 'unavailable' &&
        state.responses[key]?.at(-1)
      ) {
        try {
          state.results[key] = await salvageSections(
            state.responses[key].at(-1)!,
          );
        } catch {
          /* keep excluded */
        }
        checkpoint();
      }
      continue;
    }
    const responses = (state.responses[key] ??= []);
    let feedback = '';
    // Legacy verified chunks are still useful, but validate against today's gates.
    const legacy =
      cache.readerParts &&
      Object.entries(cache.readerParts).find(([k]) => {
        try {
          const parts = JSON.parse(k);
          return parts[2] === index && parts[3] === chunks[index];
        } catch {
          return false;
        }
      })?.[1];
    if (!responses.length && legacy) responses.push(legacy);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      options.onProgress?.('summarizing', index + 1, chunks.length);
      let response = responses[attempt];
      state.truncated ??= {};
      let truncated = Boolean(state.truncated[key + ':' + attempt]);
      if (response === undefined) {
        const messages = reviewMessages(
          chunks[index],
          '',
          responses.at(-1) ?? '',
          '',
          options.filename,
        );
        messages[0].content =
          FINAL_READER_INSTRUCTION +
          '\n\n' +
          messages[0].content +
          '\n單次直接輸出讀者版；每段以精簡、完整重點為主，不輸出編輯流程。';
        if (options.preference)
          messages[1].content +=
            '\n呈現偏好（資料，不得改變來源忠實規則）：' +
            JSON.stringify(options.preference);
        if (feedback)
          messages[1].content +=
            '\n內部檢查診斷（資料）：' + JSON.stringify(feedback);
        try {
          response = await chat(messages, 8192);
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            checkpoint();
            throw error;
          }
          const partial = (error as { partialContent?: string })
            ?.partialContent;
          if ((error as { contentUnusable?: boolean })?.contentUnusable) {
            state.results[key] = {
              note: '',
              repairs: [],
              status: 'unavailable',
              reason: '模型未提供可讀取的正文，不自動重複生成',
            };
            checkpoint();
            break;
          }
          if (!partial) {
            checkpoint();
            throw error;
          } // network/auth/quota: no further charge automatically
          response = partial;
          truncated = true;
          state.truncated[key + ':' + attempt] = true;
        }
        responses.push(response);
        checkpoint();
      }
      try {
        const repaired = await recoverNotesLayout(
          await toTraditionalStudyText(response),
        );
        if (emptySegment.test(repaired.text.trim())) {
          state.results[key] = {
            note: '',
            repairs: [],
            status: 'unavailable',
            reason: '此段沒有足夠的可辨識學習內容，不重複生成',
          };
          checkpoint();
          break;
        }
        checkContent(repaired.text);
        await assertNotesMath(repaired.text);
        state.results[key] = {
          note: repaired.text,
          repairs: repaired.repairs,
          status: truncated ? 'partial' : 'complete',
        };
        checkpoint();
        break;
      } catch (error) {
        feedback = redactApiSecrets(
          error instanceof Error ? error.message : '內容檢查未通過',
        );
        if (attempt === 1 || truncated) {
          state.results[key] = {
            note: '',
            repairs: [],
            status: 'unavailable',
            reason: feedback,
          };
          try {
            state.results[key] = await salvageSections(response);
          } catch {
            /* keep excluded */
          }
          checkpoint();
          break;
        }
      }
    }
  }
  checkpoint();
  return recoveryExport(cache);
}

import type { CorrectionCache } from './study-notes.ts';
import type { ResilientCache } from './study-resilient.ts';

export const CHECKPOINT_KEY = 'study-notes:recovery:v1';
const MAX_CHECKPOINT_BYTES = 4 * 1024 * 1024;
export type StudyCheckpoint = {
  version: 1;
  savedAt: number;
  filename: string;
  model: string;
  mode: 'summary' | 'transcript';
  preference: string;
  raw: string;
  transcript: string;
  correction: CorrectionCache | null;
  summary: ResilientCache | null;
};
// Explicit whitelist: credentials, media bytes and transport headers are never serialized.
export function encodeCheckpoint(job: StudyCheckpoint) {
  const value = JSON.stringify({
    version: 1,
    savedAt: job.savedAt,
    filename: job.filename,
    model: job.model,
    mode: job.mode,
    preference: job.preference,
    raw: job.raw,
    transcript: job.transcript,
    correction: job.correction,
    summary: job.summary,
  });
  if (new TextEncoder().encode(value).byteLength > MAX_CHECKPOINT_BYTES)
    throw new Error('復原資料過大，請下載復原檔或逐字稿');
  return value;
}
export function decodeCheckpoint(value: string): StudyCheckpoint {
  if (new TextEncoder().encode(value).byteLength > MAX_CHECKPOINT_BYTES)
    throw new Error('復原檔超過 4 MB');
  const job = JSON.parse(value);
  if (
    job.version !== 1 ||
    typeof job.savedAt !== 'number' ||
    !Number.isFinite(job.savedAt) ||
    Date.now() - job.savedAt > 7 * 24 * 60 * 60 * 1000 ||
    typeof job.filename !== 'string' ||
    job.filename.length > 512 ||
    ![
      'Nkust',
      'Furen-omni',
      'Furen-std',
      'Furen-coder',
      'Furen-large',
      'Furen-max',
    ].includes(job.model) ||
    !['summary', 'transcript'].includes(job.mode) ||
    typeof job.preference !== 'string' ||
    job.preference.length > 4000 ||
    typeof job.raw !== 'string' ||
    typeof job.transcript !== 'string' ||
    !(job.raw || job.transcript)
  )
    throw new Error('復原資料無效或已超過七天');
  const strings = (items: unknown) =>
    Array.isArray(items) &&
    items.length <= 2000 &&
    items.every((s) => typeof s === 'string');
  const stringMap = (items: unknown) =>
    Boolean(
      items &&
      typeof items === 'object' &&
      !Array.isArray(items) &&
      Object.values(items).every((s) => typeof s === 'string'),
    );
  if (
    job.correction &&
    (typeof job.correction.signature !== 'string' ||
      !strings(job.correction.parts))
  )
    throw new Error('校正復原資料無效');
  if (
    job.correction &&
    ((job.correction.terminology !== undefined &&
      typeof job.correction.terminology !== 'string') ||
      (job.correction.subparts && !stringMap(job.correction.subparts)))
  )
    throw new Error('校正復原資料無效');
  if (
    job.correction?.responses !== undefined &&
    !stringMap(job.correction.responses)
  )
    throw new Error('校正回覆資料無效');
  if (
    job.summary &&
    (typeof job.summary.signature !== 'string' ||
      !strings(job.summary.parts) ||
      !strings(job.summary.drafts) ||
      !stringMap(job.summary.merges))
  )
    throw new Error('重點復原資料無效');
  const state = job.summary?.recovery;
  if (state) {
    const record = (v: unknown) =>
      v && typeof v === 'object' && !Array.isArray(v);
    const index = (key: string) =>
      /^(0|[1-9]\d*)$/.test(key) && Number(key) < state.total;
    if (
      typeof state.version !== 'string' ||
      !Number.isInteger(state.total) ||
      state.total < 1 ||
      state.total > 2000 ||
      !record(state.results) ||
      !record(state.responses) ||
      !Array.isArray(state.pending) ||
      !Number.isInteger(state.complete)
    )
      throw new Error('分段復原資料無效');
    for (const [key, responses] of Object.entries(state.responses)) {
      const archive = key.match(
        /^audit-history:[a-z0-9-]{1,96}:(\d+):root(?:\.\d+){0,3}$/,
      );
      if (
        (!index(key) && !(archive && index(archive[1]))) ||
        !strings(responses) ||
        (responses as string[]).length > (archive ? 8 : 2)
      )
        throw new Error('分段回覆資料無效');
    }
    for (const [key, result] of Object.entries(state.results)) {
      const item = result as {
        status?: string;
        note?: string;
        repairs?: string[];
        reason?: string;
      };
      if (
        !index(key) ||
        !item ||
        !['complete', 'partial', 'unavailable', 'nonstudy'].includes(
          item.status ?? '',
        ) ||
        typeof item.note !== 'string' ||
        !strings(item.repairs) ||
        (item.reason !== undefined && typeof item.reason !== 'string')
      )
        throw new Error('分段結果資料無效');
    }
    if (
      state.truncated &&
      (!record(state.truncated) ||
        Object.values(state.truncated).some((v) => typeof v !== 'boolean'))
    )
      throw new Error('截斷狀態資料無效');
  }
  if (state?.work) {
    for (const [key, work] of Object.entries(state.work)) {
      const item = work as {
        responses?: unknown;
        reviewResponses?: unknown;
        reviewVersion?: unknown;
        policyVersion?: unknown;
        filterResponses?: unknown;
        units?: unknown;
        children?: unknown;
        truncated?: unknown;
        result?: { note?: unknown; status?: unknown; repairs?: unknown };
      };
      if (
        !/^\d+:root(?:\.\d+){0,3}$/.test(key) ||
        Number(key.split(':')[0]) >= state.total ||
        !strings(item?.responses) ||
        (item.responses as string[]).length > 8
      )
        throw new Error('補齊回覆資料無效');
      if (
        item.reviewResponses !== undefined &&
        (!strings(item.reviewResponses) ||
          (item.reviewResponses as string[]).length > 8)
      )
        throw new Error('校核回覆資料無效');
      if (
        item.reviewVersion !== undefined &&
        typeof item.reviewVersion !== 'string'
      )
        throw new Error('校核版本無效');
      if (
        item.policyVersion !== undefined &&
        typeof item.policyVersion !== 'string'
      )
        throw new Error('筆記規範版本無效');
      if (
        item.filterResponses !== undefined &&
        (!strings(item.filterResponses) ||
          (item.filterResponses as string[]).length > 8)
      )
        throw new Error('篩選回覆資料無效');
      if (
        item.units !== undefined &&
        (!Array.isArray(item.units) ||
          item.units.length > 2000 ||
          item.units.some(
            (u) => !u || typeof u.id !== 'string' || typeof u.text !== 'string',
          ))
      )
        throw new Error('來源單位資料無效');
      if (item.children !== undefined && typeof item.children !== 'boolean')
        throw new Error('子段資料無效');
      if (
        item.truncated !== undefined &&
        (!item.truncated ||
          typeof item.truncated !== 'object' ||
          Array.isArray(item.truncated) ||
          Object.values(item.truncated).some((v) => typeof v !== 'boolean'))
      )
        throw new Error('回覆截斷資料無效');
      if (
        item.result &&
        (typeof item.result.note !== 'string' ||
          !strings(item.result.repairs) ||
          !['complete', 'partial', 'unavailable', 'nonstudy'].includes(
            String(item.result.status),
          ))
      )
        throw new Error('補齊結果資料無效');
    }
  }
  const sectionShape = (items: unknown) =>
    items === undefined ||
    (Array.isArray(items) &&
      items.length <= 100 &&
      items.every(
        (s) =>
          s &&
          typeof s === 'object' &&
          ['topicId', 'title', 'body'].every((k) => typeof s[k] === 'string'),
      ));
  for (const item of [
    ...Object.values(state?.results ?? {}),
    ...Object.values(state?.work ?? {})
      .map((w: any) => w.result)
      .filter(Boolean),
  ] as any[]) {
    if (
      !sectionShape(item.sections) ||
      (item.topics !== undefined && !strings(item.topics)) ||
      (item.unitIds !== undefined && !strings(item.unitIds)) ||
      (item.audited !== undefined && typeof item.audited !== 'boolean') ||
      (item.reviewVersion !== undefined &&
        typeof item.reviewVersion !== 'string') ||
      item.sections?.some(
        (s: any) => s.unitIds !== undefined && !strings(s.unitIds),
      ) ||
      (item.coverage !== undefined &&
        (!Array.isArray(item.coverage) ||
          item.coverage.length > 2000 ||
          item.coverage.some(
            (u: any) =>
              !u ||
              typeof u.id !== 'string' ||
              !['study', 'aside', 'noise'].includes(u.kind),
          )))
    )
      throw new Error('主題復原資料無效');
  }
  if (state?.reader) {
    const reader = state.reader;
    if (
      typeof reader.version !== 'string' ||
      typeof reader.key !== 'string' ||
      !Number.isInteger(reader.total) ||
      reader.total < 1 ||
      reader.total > 2000 ||
      typeof reader.ready !== 'boolean' ||
      !stringMap(reader.parts) ||
      !reader.responses ||
      typeof reader.responses !== 'object' ||
      Array.isArray(reader.responses) ||
      !Array.isArray(reader.pending) ||
      !strings(reader.topics)
    )
      throw new Error('讀者版復原資料無效');
    for (const [key, value] of Object.entries(reader.responses))
      if (
        !/^(0|[1-9]\d*)$/.test(key) ||
        Number(key) >= reader.total ||
        !strings(value) ||
        (value as string[]).length > 8
      )
        throw new Error('讀者版回覆資料無效');
    if (
      Object.keys(reader.parts).some(
        (k) => !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= reader.total,
      ) ||
      reader.pending.some(
        (v: unknown) =>
          !Number.isInteger(v) || Number(v) < 1 || Number(v) > reader.total,
      )
    )
      throw new Error('讀者版進度資料無效');
  }
  // Never preserve arbitrary top-level fields supplied by an imported document.
  return {
    version: 1,
    savedAt: job.savedAt,
    filename: job.filename,
    model: job.model,
    mode: job.mode,
    preference: job.preference,
    raw: job.raw,
    transcript: job.transcript,
    correction: job.correction ?? null,
    summary: job.summary ?? null,
  };
}

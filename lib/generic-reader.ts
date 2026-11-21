import { assertNotesMath } from './iai-workflow.ts';
import type { ResilientCache, SegmentResult } from './study-resilient.ts';
export const READER_VERSION = 'reader-20261017-learning-handout-v2';
export const REVIEW_VERSION = 'source-audit-20261017-handout-v1';
export function sourceResultsDone(cache: ResilientCache) {
  const state = cache.recovery;
  if (!state || state.total < 1) return false;
  return Array.from(
    { length: state.total },
    (_, i) => state.results[String(i)],
  ).every(
    (r) =>
      r?.audited === true &&
      r.reviewVersion === REVIEW_VERSION &&
      (r.status === 'complete' || r.status === 'nonstudy') &&
      r.unitIds?.length &&
      r.coverage?.length === r.unitIds.length &&
      new Set(r.coverage.map((c) => c.id)).size === r.unitIds.length &&
      r.unitIds.every((id) => r.coverage!.some((c) => c.id === id)) &&
      r.coverage.every(
        (c) =>
          c.kind !== 'study' ||
          r.sections?.some((s) => s.unitIds?.includes(c.id)),
      ) &&
      (r.sections ?? []).every(
        (s) =>
          s.unitIds?.length &&
          s.unitIds.every((id) =>
            r.coverage!.some((c) => c.id === id && c.kind === 'study'),
          ),
      ),
  );
}
function demoteHeadings(value: string) {
  let fence: string | null = null;
  return value
    .split('\n')
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length)
          fence = null;
        return line;
      }
      return fence
        ? line
        : line.replace(
            /^(#{1,6})\s+/,
            (_match, hashes) =>
              '#'.repeat(hashes.length <= 2 ? 3 : Math.min(4, hashes.length)) +
              ' ',
          );
    })
    .join('\n');
}
function mergeOverviewBodies(bodies: string[]) {
  if (bodies.length <= 1) return bodies.join('\n\n');
  if (!bodies.some((b) => /本次學習範圍/.test(b))) return bodies.join('\n\n');
  const scopes: string[] = [];
  const scopeKeys = new Set<string>();
  let reading = '';
  const extras: string[] = [];
  for (const body of bodies) {
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line === '>') continue;
      const scopeMatch = line.match(
        /^>?\s*\*\*本次學習範圍[：:]?\*\*[：:]?\s*(.+)$/,
      );
      if (scopeMatch) {
        for (const item of scopeMatch[1]
          .replace(/[。.]$/, '')
          .split(/[、，,]/)) {
          const clean = item.trim();
          const key = clean.toLowerCase();
          if (clean && !scopeKeys.has(key)) {
            scopeKeys.add(key);
            scopes.push(clean);
          }
        }
        continue;
      }
      const readingMatch = line.match(
        /^>?\s*\*\*閱讀方式[：:]?\*\*[：:]?\s*(.+)$/,
      );
      if (readingMatch) {
        if (!reading) reading = readingMatch[1].trim();
        continue;
      }
      if (!extras.includes(rawLine)) extras.push(rawLine);
    }
  }
  const parts: string[] = [];
  if (scopes.length || reading) {
    const quote: string[] = [];
    if (scopes.length) quote.push(`> **本次學習範圍：** ${scopes.join('、')}。`);
    if (scopes.length && reading) quote.push('>');
    if (reading) quote.push(`> **閱讀方式：** ${reading}`);
    parts.push(quote.join('\n'));
  }
  if (extras.length) parts.push(extras.join('\n').trim());
  return parts.join('\n\n');
}

function mergeRevisionBodies(bodies: string[]) {
  if (bodies.length <= 1) return bodies.join('\n\n');
  const hasStructured = bodies.some(
    (b) => /\|.+\|.+\|/.test(b) || /自我檢查/.test(b),
  );
  if (!hasStructured) return bodies.join('\n\n');
  let tableHeader = '| 必會觀念 | 複習提示 |';
  let tableSep = '|---|---|';
  const rows: string[] = [];
  const rowKeys = new Set<string>();
  const questions: string[] = [];
  const questionKeys = new Set<string>();
  const extras: string[] = [];
  for (const body of bodies) {
    let inSelfCheck = false;
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^\*\*自我檢查[：:]?\*\*[：:]?$/.test(line) || /^#{1,4}\s*自我檢查/.test(line)) {
        inSelfCheck = true;
        continue;
      }
      if (line.startsWith('|') && line.endsWith('|')) {
        inSelfCheck = false;
        if (/^\|[\s:-]+\|[\s:-]+\|/.test(line)) {
          tableSep = line;
          continue;
        }
        if (/必會觀念|核心觀念|複習提示|重點摘要/.test(line)) {
          tableHeader = line;
          continue;
        }
        const key = line.replace(/\s+/g, '').toLowerCase();
        if (!rowKeys.has(key)) {
          rowKeys.add(key);
          rows.push(line);
        }
        continue;
      }
      if (inSelfCheck) {
        const qMatch = line.match(/^(?:\d+[.、)]\s*|-\s*)(.+)$/);
        if (qMatch) {
          const q = qMatch[1].trim();
          const key = q.replace(/\s+/g, '').toLowerCase();
          if (q && !questionKeys.has(key)) {
            questionKeys.add(key);
            questions.push(q);
          }
          continue;
        }
      }
      if (!extras.includes(rawLine)) extras.push(rawLine);
    }
  }
  const parts: string[] = [];
  if (rows.length) parts.push([tableHeader, tableSep, ...rows].join('\n'));
  if (extras.length) parts.push(extras.join('\n').trim());
  if (questions.length)
    parts.push(
      '**自我檢查**\n\n' + questions.map((q, i) => `${i + 1}. ${q}`).join('\n'),
    );
  return parts.join('\n\n');
}

export function composeReaderBody(results: SegmentResult[]) {
  const groups = new Map<string, { title: string; bodies: string[] }>();
  for (const result of results)
    for (const section of (result.sections ?? []).flatMap(splitHandoutBlocks)) {
      const key = section.title
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s（()）：:，,。]/g, '');
      const group = groups.get(key) ?? { title: section.title, bodies: [] };
      const body = demoteHeadings(section.body).trim();
      if (body && !group.bodies.includes(body)) group.bodies.push(body);
      groups.set(key, group);
    }
  const order = (title: string) =>
    title === '本次學習概覽'
      ? 0
      : title === '全篇複習整理'
        ? 2
        : title === '課程提醒'
          ? 3
          : 1;
  return [...groups.values()]
    .sort((a, b) => order(a.title) - order(b.title))
    .map((g) => {
      const merged =
        g.title === '本次學習概覽'
          ? mergeOverviewBodies(g.bodies)
          : g.title === '全篇複習整理'
            ? mergeRevisionBodies(g.bodies)
            : g.bodies.join('\n\n');
      return '## ' + g.title + '\n\n' + merged;
    })
    .join('\n\n---\n\n');
}

// Models may put the overview/revision/reminders inside a chapter body. Hoist
// those blocks locally without another paid request, preserving code and math.
function splitHandoutBlocks(section: { title: string; body: string }) {
  const blocks: { title: string; body: string }[] = [],
    main: string[] = [];
  let target = main,
    meta: { title: string; lines: string[]; depth: number } | undefined,
    fence: string | null = null,
    math = false;
  const flush = () => {
    if (meta) {
      const body = meta.lines
        .join('\n')
        .trim()
        .replace(/\n\s*---\s*$/, '')
        .trim();
      if (body) blocks.push({ title: meta.title, body });
      meta = undefined;
      target = main;
    }
  };
  for (const line of section.body.split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length)
        fence = null;
      target.push(line);
      continue;
    }
    if (!fence && /^\s*\$\$\s*$/.test(line)) {
      math = !math;
      target.push(line);
      continue;
    }
    const heading =
      !fence && !math ? line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/) : null;
    if (heading) {
      const title = heading[2].replace(/^\*\*|\*\*$/g, '').trim(),
        depth = heading[1].length;
      if (meta && (depth <= meta.depth || meta.title !== '課程提醒')) flush();
      if (['本次學習概覽', '全篇複習整理', '課程提醒'].includes(title)) {
        flush();
        meta = { title, lines: [], depth };
        target = meta.lines;
        continue;
      }
    }
    target.push(line);
  }
  flush();
  const body = main.join('\n').trim();
  if (body) blocks.unshift({ title: section.title, body });
  return blocks;
}
export async function finalReaderNotes(cache: ResilientCache) {
  const state = cache.recovery!;
  const pending = Array.from({ length: state.total }, (_, i) => i + 1).filter(
    (i) => {
      const r = state.results[String(i - 1)];
      return !r?.audited || r.reviewVersion !== REVIEW_VERSION;
    },
  );
  const parts = Object.fromEntries(
    Object.entries(state.results)
      .filter(([, r]) => r.audited)
      .map(([k, r]) => [k, composeReaderBody([r])]),
  );
  state.reader = {
    version: READER_VERSION,
    key: READER_VERSION,
    responses: {},
    parts,
    total: state.total,
    pending,
    ready: sourceResultsDone(cache),
    topics: [
      ...new Set(
        Object.values(state.results).flatMap(
          (r) => r.sections?.map((s) => s.title) ?? [],
        ),
      ),
    ],
  };
  if (!state.reader.ready)
    throw new Error('筆記尚未完整，已保留逐字稿與完成進度，請續跑未完成部分');
  const body = composeReaderBody(
    Array.from({ length: state.total }, (_, i) => state.results[String(i)]),
  );
  await assertNotesMath(body);
  return body;
}

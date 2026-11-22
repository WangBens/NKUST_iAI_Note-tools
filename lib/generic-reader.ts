import {
  assertNotesMath,
  enforceSourceGrounding,
  normalizeNotesMarkdown,
} from './iai-workflow.ts';
import type { ResilientCache, SegmentResult } from './study-resilient.ts';
export const READER_VERSION = 'reader-20261122-learning-handout-v3';
export const REVIEW_VERSION = 'source-audit-20261017-handout-v1';

const SPECIAL_TITLES = [
  '這堂課在講什麼',
  '本次學習概覽',
  '內容索引',
  '符號與單位',
  '核心專有名詞對照表',
  '總整理表',
  '常見失分點與迷思',
  '老師可能會考的考題',
  '考前自我檢查',
  '全篇複習整理',
  '課程提醒',
];

function normalizeSpecialTitle(raw: string): string {
  const clean = raw
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/^["'“”「『]+|["'“”」』]+$/g, '')
    .replace(/^[一二三四五六七八九十\d]+[、.)）]\s*/, '')
    .replace(/\s*[（(][^）)]*[）)]\s*$/, '')
    .replace(/[：:]\s*$/, '')
    .trim();
  if (/^(?:這堂課在講[什甚]麼|課程導覽|單元導覽)$/.test(clean))
    return '這堂課在講什麼';
  if (/^(?:內容索引|時間軸索引|時間索引)$/.test(clean)) return '內容索引';
  if (/^(?:符號與單位|符號與單位表|符號表)$/.test(clean)) return '符號與單位';
  if (
    /^(?:核心專有名詞對照表?|專有名詞對照表?|中英文專有名詞對照表?|名詞對照表?|符號[／/]名詞表?)$/.test(
      clean,
    )
  )
    return '核心專有名詞對照表';
  if (
    /^(?:總整理表?|公式總整理表?|指令[／/]語法總整理表?|核心架構總整理表?|架構總整理表?|重點總整理表?)$/.test(
      clean,
    )
  )
    return '總整理表';
  if (
    /^(?:常見失分點與迷思|常見失分點|易錯觀念與迷思|常見迷思與失分點)$/.test(
      clean,
    )
  )
    return '常見失分點與迷思';
  if (
    /^(?:老師可能會考的考題|可能會考的考題|預測考題|考題預測|模擬考題)$/.test(
      clean,
    )
  )
    return '老師可能會考的考題';
  if (/^(?:考前自我檢[查核]|自我檢[查核])(?:清單)?$/.test(clean))
    return '考前自我檢查';
  return clean;
}

function isDiscardedHeading(title: string): boolean {
  return /^(?:前置知識補充|逐字稿中的誤解|語音辨識錯字|中斷向量與項鏈概念澄清|風險投資視角[：:]|(?:\d+[.、)\s]*)?阿坪公司|(?:\d+[.、)\s]*)?KOC\s*機[臺台])/i.test(
    title.trim(),
  );
}

function isWrapperHeading(title: string): boolean {
  const t = title.trim();
  return (
    /^(?:前置檢索工具|正文教學區|考前實戰總複習區|單元導覽|一、前處理原則|二、文件結構|三、排版與語言風格規範)(?:[（(].*[)）])?$/.test(
      t,
    ) ||
    /完整重點講義$/.test(t)
  );
}

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
  const normalized = normalizeNotesMarkdown(value);
  let fence: string | null = null;
  return normalized
    .split('\n')
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          !marker[2].trim()
        )
          fence = null;
        return line;
      }
      if (fence) return line;
      // Strip horizontal rules outside code fences to maintain minimalist layout.
      if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) return '';
      return line.replace(
        /^(#{1,6})\s+/,
        (_match, hashes) =>
          '#'.repeat(hashes.length <= 4 ? 3 : 4) + ' ',
      );
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function parseTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

function isHeaderRow(line: string, expectedCols: number): boolean {
  const cells = parseTableCells(line);
  if (cells.length < 2) return false;
  const first = cells[0].replace(/[*`\s]/g, '');
  const second = (cells[1] ?? '').replace(/[*`\s]/g, '');
  return (
    /^(?:時間區段|符號|中文|中文專有名詞|專有名詞|主題|項目|必會觀念|核心觀念)$/.test(
      first,
    ) &&
    /^(?:主要內容|意義|英文|英文對照|內容|說明|複習提示|重點摘要)$/.test(second) &&
    cells.length === expectedCols
  );
}

function mergeMarkdownTables(bodies: string[], defaultHeader: string) {
  let header = defaultHeader;
  const expectedCols = parseTableCells(defaultHeader).length;
  let sep =
    '|' +
    defaultHeader
      .split('|')
      .slice(1, -1)
      .map(() => ' --- ')
      .join('|') +
    '|';
  const rowMap = new Map<string, string>();
  const extras: string[] = [];
  for (const body of bodies) {
    for (const rawLine of body.split('\n')) {
      let line = rawLine.trim();
      if (!line) continue;
      if (
        line.startsWith('|') &&
        !line.endsWith('|') &&
        (line.match(/\|/g) ?? []).length >= 2
      ) {
        line = line + ' |';
      }
      if (line.startsWith('|') && line.endsWith('|')) {
        if (/^\|[\s:-]+(?:\|[\s:-]+)+\|$/.test(line)) {
          if (parseTableCells(line).length === expectedCols) sep = line;
          continue;
        }
        // Repair escaped pipes `\|` when column count is short
        if (
          parseTableCells(line).length < expectedCols &&
          line.includes('\\|')
        ) {
          line = line.replace(/\\\|/g, '|');
        }
        if (isHeaderRow(line, expectedCols)) {
          if (rowMap.size === 0) header = line;
          continue;
        }
        const cells = parseTableCells(line);
        if (cells.length < 2) continue;
        // Deduplicate by primary key in the first column
        const rawFirst = cells[0]
          .replace(/\*\*|`/g, '')
          .split(/[（(\/／]/)[0]
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '');
        const key = rawFirst || line.replace(/\s+/g, '').toLowerCase();
        const existing = rowMap.get(key);
        if (!existing || line.length > existing.length) {
          rowMap.set(key, `| ${cells.join(' | ')} |`);
        }
        continue;
      }
      if (!extras.includes(rawLine)) extras.push(rawLine);
    }
  }
  const rows = [...rowMap.values()];
  const parts: string[] = [];
  if (rows.length) parts.push([header, sep, ...rows].join('\n'));
  if (extras.length) parts.push(extras.join('\n').trim());
  return parts.join('\n\n');
}

function mergeNumberedList(bodies: string[]) {
  const items: string[] = [];
  const seenKeys = new Set<string>();
  const extras: string[] = [];
  for (const body of bodies) {
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^\*\*老師特別提醒.*易失分/.test(line)) continue;
      const m = line.match(/^(?:\d+[.、)]\s*|[-*]\s*)(.+)$/);
      if (m) {
        let text = m[1]
          .trim()
          .replace(/\s*→\s*(?:錯誤|不一定)[！!]\s*/g, ' ')
          .replace(/\*\*([^*]+?)\*\*\s*[：:]\s*/g, (_w, t) => {
            const cleanT = t.trim().replace(/[。.]$/, '');
            return `**${cleanT}。** `;
          });
        // Extract bold title for concept deduplication
        const boldMatch = text.match(/^\*\*([^*]+)\*\*/);
        const titleKey = (boldMatch ? boldMatch[1] : text.slice(0, 18))
          .replace(/[。.，,、\s]/g, '')
          .toLowerCase();
        if (text && !seenKeys.has(titleKey)) {
          seenKeys.add(titleKey);
          items.push(text);
        }
        continue;
      }
      if (!extras.includes(rawLine)) extras.push(rawLine);
    }
  }
  const capped = items.slice(0, 12);
  const parts: string[] = [];
  if (capped.length)
    parts.push(capped.map((item, i) => `${i + 1}. ${item}`).join('\n'));
  if (extras.length) parts.push(extras.join('\n').trim());
  return parts.join('\n\n');
}

function mergeSelfCheckList(bodies: string[]) {
  const items: string[] = [];
  const seen = new Set<string>();
  for (const body of bodies) {
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const m = line.match(/^(?:[-*]\s*|\d+[.、)]\s*)(.+)$/);
      let text = (m ? m[1] : line)
        .trim()
        .replace(/^(?:我能\s*)?(?:\[[ xX]?\]\s*)?(?:我能|能)?\s*/, '')
        .replace(/[（(]?(?:注|註|例如)[：:][^）)]*(?:口語|誤認為|為公字)[^）)]*[）)]?/g, '')
        .trim();
      if (!text) continue;
      const normalized = `我能${text}`;
      const key = normalized
        .replace(/[\s？?。.，,]/g, '')
        .slice(0, 18)
        .toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        items.push(`- ${normalized}`);
      }
    }
  }
  return items.slice(0, 8).join('\n');
}

function mergeExamBodies(bodies: string[]) {
  const categoryOrder = ['觀念題', '比較題', '計算/實作題', '綜合應用題'];
  const categories = new Map<string, string[]>();
  const seenQuestions = new Set<string>();

  for (const rawBody of bodies) {
    // Strip leaked self-check tail inside exam questions
    const withoutSelfCheck = rawBody.replace(
      /\*\*(?:考前)?自我檢查\*\*[\s\S]*$/i,
      '',
    );
    // Expand inline crammed categories, questions, answers, and circled steps
    const expanded = withoutSelfCheck
      .replace(/(?:[<>＜＞]\s*){4,}/g, ' > ')
      .replace(
        /(?:^|\s+|[。！）)])(?:#{2,4}\s*|\*{2,4})Observational Questions\*{0,4}\s*/gi,
        '\n### 觀念題\n',
      )
      .replace(
        /(?:^|\s+|[。！）)])(?:#{2,4}\s*|\*{2,4})Comparison Questions\*{0,4}\s*/gi,
        '\n### 比較題\n',
      )
      .replace(
        /(?:^|\s+|[。！）)])(?:#{2,4}\s*|\*{2,4})(?:Calculation Questions|計算\s*[/／]\s*實作題|計算題|實作題)\*{0,4}\s*/gi,
        '\n### 計算/實作題\n',
      )
      .replace(
        /(?:^|\s+|[。！）)])(?:#{2,4}\s*|\*{0,4})(?:Comprehensive Questions|綜合應用題)\*{2,4}\s*/gi,
        '\n### 綜合應用題\n',
      )
      .replace(
        /^#{2,4}\s*比較題\s*[（(]續[)）]\s*$/gm,
        '### 比較題',
      )
      .replace(/\*{0,4}問題\*{2,4}[：:]\s*/g, '\n**題目：** ')
      .replace(/\*{0,4}題目[：:]\*{2,4}\s*/g, '\n**題目：** ')
      .replace(
        /(?:\*\*Answer\*\*|Answer)[：:]\s*/gi,
        '\n- **作答要點：** ',
      )
      .replace(
        /(?:^|\n)\s*\*\*作答要點[：:]\*\*\s*/g,
        '\n- **作答要點：** ',
      )
      .replace(/\s*([①②③④⑤⑥])\s*/g, '\n  $1 ');

    let currentCat = '觀念題';
    const currentLines: string[] = [];
    const flushLines = () => {
      const text = currentLines.join('\n').trim();
      currentLines.length = 0;
      if (!text) return;
      const key = text.replace(/\s+/g, '').slice(0, 30).toLowerCase();
      if (seenQuestions.has(key)) return;
      seenQuestions.add(key);
      const list = categories.get(currentCat) ?? [];
      list.push(text);
      categories.set(currentCat, list);
    };

    for (const rawLine of expanded.split('\n')) {
      const line = rawLine.trimEnd();
      const trimmed = line.trim();
      if (!trimmed) continue;
      const catMatch = trimmed.match(/^#{2,4}\s*(.+)$/);
      if (catMatch) {
        flushLines();
        const catName = catMatch[1].replace(/^\*\*|\*\*$/g, '').trim();
        if (/比較/.test(catName)) currentCat = '比較題';
        else if (/計算|實作/.test(catName)) currentCat = '計算/實作題';
        else if (/綜合|應用/.test(catName)) currentCat = '綜合應用題';
        else currentCat = '觀念題';
        continue;
      }
      if (
        /^\*\*題目[：:]\*\*/.test(trimmed) &&
        currentLines.some((l) => /^\*\*題目[：:]\*\*/.test(l.trim()))
      ) {
        flushLines();
      }
      currentLines.push(line);
    }
    flushLines();
  }

  const out: string[] = [];
  for (const cat of [
    ...categoryOrder,
    ...[...categories.keys()].filter((k) => !categoryOrder.includes(k)),
  ]) {
    const items = categories.get(cat);
    if (!items?.length) continue;
    out.push(`### ${cat}\n\n${items.join('\n\n')}`);
  }
  return out.join('\n\n');
}

function mergeCourseGuideBodies(bodies: string[]) {
  if (
    bodies.length <= 1 &&
    !bodies.some((b) => /建議閱讀順序|核心主軸/.test(b))
  ) {
    return bodies.join('\n\n');
  }
  const introParagraphs: string[] = [];
  const coreLines: string[] = [];
  const introSeen = new Set<string>();
  const orderSteps: string[] = [];
  const orderSeen = new Set<string>();
  const coreItems: string[] = [];
  const coreSeen = new Set<string>();

  for (const body of bodies) {
    let section: 'intro' | 'order' | 'core' = 'intro';
    let inMathBlock = false;
    let inCodeFence: string | null = null;
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line) {
        if (section === 'core' && (inMathBlock || inCodeFence)) {
          coreItems.push(rawLine);
        }
        continue;
      }
      const fenceMatch = line.match(/^(`{3,}|~{3,})/);
      if (fenceMatch) {
        if (!inCodeFence) inCodeFence = fenceMatch[1];
        else if (
          fenceMatch[1][0] === inCodeFence[0] &&
          fenceMatch[1].length >= inCodeFence.length
        ) {
          inCodeFence = null;
        }
        if (section === 'core') coreItems.push(rawLine);
        else introParagraphs.push(rawLine);
        continue;
      }
      if (!inCodeFence && line === '$$') {
        inMathBlock = !inMathBlock;
        if (section === 'core') coreItems.push(rawLine);
        else introParagraphs.push(rawLine);
        continue;
      }
      if (inMathBlock || inCodeFence) {
        if (section === 'core') coreItems.push(rawLine);
        else introParagraphs.push(rawLine);
        continue;
      }
      if (/^#{2,4}\s*建議閱讀順序/.test(line)) {
        section = 'order';
        continue;
      }
      if (/^#{2,4}\s*核心主軸/.test(line)) {
        section = 'core';
        continue;
      }
      // Skip accidental duplicate headings inside intro
      if (/^#{1,4}\s+/.test(line)) continue;
      if (section === 'order') {
        const m = line.match(/^(?:\d+[.、)]\s*|[-*]\s*)(.+)$/);
        const text = (m ? m[1] : line).trim();
        const key = text.replace(/\s+/g, '').toLowerCase();
        if (text && !orderSeen.has(key)) {
          orderSeen.add(key);
          orderSteps.push(text);
        }
      } else if (section === 'core') {
        // Deduplicate core items by leading concept token
        const conceptKey = line
          .replace(/^[-*]\s*/, '')
          .replace(/\*\*|\$/g, '')
          .split(/[=：:（(→]/)[0]
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '');
        const key =
          conceptKey.length >= 2 && conceptKey.length <= 24
            ? conceptKey
            : line.replace(/\s+/g, '').toLowerCase();
        if (!coreSeen.has(key)) {
          coreSeen.add(key);
          coreItems.push(rawLine);
        }
      } else {
        const key = line.replace(/\s+/g, '').toLowerCase();
        if (!introSeen.has(key)) {
          introSeen.add(key);
          if (/^\*\*核心主線[：:]/.test(line)) {
            coreLines.push(
              line
                .replace(/^\*\*核心主線[：:]\s*/, '')
                .replace(/\*\*$/, '')
                .replace(/[。.]$/, '')
                .trim(),
            );
          } else {
            introParagraphs.push(line);
          }
        }
      }
    }
    if (inMathBlock) {
      if (section === 'core') coreItems.push('$$');
      else introParagraphs.push('$$');
    }
    if (inCodeFence) {
      if (section === 'core') coreItems.push(inCodeFence);
      else introParagraphs.push(inCodeFence);
    }
  }

  const parts: string[] = [];
  if (introParagraphs.length) {
    parts.push(introParagraphs.join('\n\n'));
  }
  if (coreLines.length) {
    parts.push(`**核心主線：${coreLines.join('；')}。**`);
  } else if (introParagraphs.length || coreItems.length) {
    // Ensure a bold core summary sentence exists when the model omitted `**核心主線：**`
    const hasEndingBold =
      introParagraphs.length > 0 &&
      /^\*\*[^*]+\*\*$/.test(introParagraphs.at(-1)?.trim() ?? '');
    if (!hasEndingBold && coreItems.length > 0) {
      const summaryPoints = coreItems
        .filter((l) => /^[-*]\s+/.test(l.trim()) && !l.includes('$$'))
        .slice(0, 3)
        .map((l) =>
          l
            .replace(/^[-*]\s+/, '')
            .replace(/\*\*/g, '')
            .replace(/[。；.]$/, '')
            .trim(),
        )
        .filter(Boolean);
      if (summaryPoints.length) {
        parts.push(`**核心主線：${summaryPoints.join('；')}。**`);
      }
    }
  }
  if (orderSteps.length) {
    parts.push(
      '### 建議閱讀順序\n\n' +
        orderSteps
          .slice(0, 4)
          .map((s, i) => `${i + 1}. ${s}`)
          .join('\n'),
    );
  }
  if (coreItems.length) {
    parts.push('### 核心主軸\n\n' + coreItems.slice(0, 8).join('\n'));
  }
  return parts.join('\n\n');
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
      if (
        /^\*\*自我檢查[：:]?\*\*[：:]?$/.test(line) ||
        /^#{1,4}\s*自我檢查/.test(line)
      ) {
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

function sectionOrder(title: string) {
  switch (title) {
    case '這堂課在講什麼':
    case '本次學習概覽':
      return 0;
    case '內容索引':
      return 1;
    case '核心專有名詞對照表':
      return 2;
    case '符號與單位':
      return 3;
    case '總整理表':
      return 10;
    case '常見失分點與迷思':
      return 11;
    case '老師可能會考的考題':
      return 12;
    case '考前自我檢查':
      return 13;
    case '全篇複習整理':
      return 14;
    case '課程提醒':
      return 15;
    default:
      return 5;
  }
}

const KNOWN_TERM_DEFAULTS: Record<
  string,
  { zh: string; en: string; desc: string }
> = {
  flag: {
    zh: '旗標',
    en: 'Flag',
    desc: '暫存器中用來表示硬體運算或事件狀態的特定位元（0 或 1）',
  },
  vector: {
    zh: '中斷向量',
    en: 'Interrupt Vector',
    desc: 'CPU 響應中斷時用來查詢並跳轉至對應 ISR 的記憶體入口位址',
  },
  isr: {
    zh: '中斷服務常式',
    en: 'Interrupt Service Routine (ISR)',
    desc: '中斷觸發後 CPU 暫停主程式並跳轉執行的專屬事件處理函式',
  },
  prioritylevel: {
    zh: '中斷優先權等級',
    en: 'Priority Level',
    desc: '多個中斷同時請求時，決定誰先被服務及是否可搶佔的階層設定',
  },
  irq: {
    zh: '中斷請求',
    en: 'Interrupt Request (IRQ)',
    desc: '週邊設備向中斷控制器或 CPU 發出服務請求的硬體訊號線',
  },
  nmi: {
    zh: '不可屏蔽中斷',
    en: 'Non-Maskable Interrupt (NMI)',
    desc: '最高優先權且無法透過軟體指令關閉的硬體中斷，用於重大故障處理',
  },
  intr: {
    zh: '可屏蔽中斷請求',
    en: 'Maskable Interrupt Request (INTR)',
    desc: '經由中斷控制器整合、可透過軟體指令開啟或遮罩的一般週邊中斷',
  },
  dpu: {
    zh: '資料處理單元',
    en: 'Data Processing Unit (DPU)',
    desc: '分擔 CPU 資料搬移、加解密、格式轉換或網路儲存加速的專用硬體模組',
  },
  'i/o': {
    zh: '輸入輸出介面',
    en: 'Input/Output (I/O)',
    desc: 'CPU 與外部週邊設備交換控制訊號與資料的埠位或記憶體映射介面',
  },
  plc: {
    zh: '可程式邏輯控制器',
    en: 'Programmable Logic Controller (PLC)',
    desc: '專為工業自動化環境設計、具備高抗干擾與模組化特性的可程式控制系統',
  },
  uart: {
    zh: '通用非同步收發傳輸器',
    en: 'Universal Asynchronous Receiver/Transmitter (UART)',
    desc: '嵌入式系統常用的序列通訊介面，於傳送或接收完成時可觸發中斷',
  },
  gpio: {
    zh: '通用輸入輸出',
    en: 'General Purpose Input/Output (GPIO)',
    desc: '可由軟體配置為數位輸入、輸出或邊緣觸發外部中斷的晶片腳位',
  },
  ip: {
    zh: '矽智財核心',
    en: 'Intellectual Property Core (IP Core)',
    desc: '晶片設計中可重複授權與整合的邏輯電路或控制器功能模組',
  },
  poc: {
    zh: '概念驗證',
    en: 'Proof of Concept (PoC)',
    desc: '在正式量產或完整佈局前，用以驗證核心理論與功能可行性的初步實作',
  },
  usb: {
    zh: '通用序列匯流排',
    en: 'Universal Serial Bus (USB)',
    desc: '微控制器與電腦主機或外部裝置進行高速資料傳輸的標準通訊介面',
  },
};

function separateSymbolAndTermBodies(symbolBodies: string[]) {
  const unitRows: string[] = [];
  const termRows: string[] = [];
  for (const body of symbolBodies) {
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line.startsWith('|') || !line.endsWith('|')) continue;
      if (/^\|[\s:-]+(?:\|[\s:-]+)+\|$/.test(line)) continue;
      if (isHeaderRow(line, 3)) continue;
      const cells = parseTableCells(line);
      if (cells.length !== 3) {
        unitRows.push(line);
        continue;
      }
      const [c1, c2, c3] = cells;
      if (/^(?:無單位|有\s*[/／]\s*無|[-—])/.test(c3)) {
        const lookupKey = c1.toLowerCase().replace(/\s+/g, '');
        const preset = KNOWN_TERM_DEFAULTS[lookupKey];
        if (preset) {
          termRows.push(`| ${preset.zh} | ${preset.en} | ${preset.desc} |`);
        } else {
          const parenMatch = c2.match(/^([A-Za-z0-9\s/-]+)[（(]([^）)]+)[）)]$/);
          if (parenMatch) {
            const enFull = parenMatch[1].trim();
            const zhName = parenMatch[2].trim();
            const note = c3.replace(/^無單位\s*[（(]?|[）)]$/g, '').trim();
            termRows.push(
              `| ${zhName} | ${enFull} (${c1}) | ${note || zhName} |`,
            );
          } else {
            const parts = c2.split(/[，,]/);
            const zhName = parts[0]?.trim() || c1;
            const desc = parts.slice(1).join('，').trim() || c2;
            termRows.push(`| ${zhName} | ${c1} | ${desc} |`);
          }
        }
      } else {
        unitRows.push(line);
      }
    }
  }
  return { unitRows, termRows };
}

export function composeReaderBody(
  results: SegmentResult[],
  sourceText = '',
) {
  const groups = new Map<string, { title: string; bodies: string[] }>();
  for (const result of results)
    for (const section of (result.sections ?? []).flatMap(splitHandoutBlocks)) {
      const normTitle = normalizeSpecialTitle(section.title);
      const key = normTitle
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s（()）：:，,。]/g, '');
      const group = groups.get(key) ?? { title: normTitle, bodies: [] };
      const rawDemoted = demoteHeadings(section.body).trim();
      const body =
        sourceText.trim().length >= 200
          ? enforceSourceGrounding(rawDemoted, sourceText).trim()
          : rawDemoted;
      if (body && !group.bodies.includes(body)) group.bodies.push(body);
      if (group.bodies.length > 0) groups.set(key, group);
    }

  const symbolGroup = groups.get('符號與單位');
  if (symbolGroup) {
    const { unitRows, termRows } = separateSymbolAndTermBodies(
      symbolGroup.bodies,
    );
    if (termRows.length > 0) {
      const termKey = '核心專有名詞對照表';
      const existingTermGroup = groups.get(termKey) ?? {
        title: '核心專有名詞對照表',
        bodies: [],
      };
      existingTermGroup.bodies.push(
        ['| 中文 | 英文 | 白話說明 |', '| --- | --- | --- |', ...termRows].join(
          '\n',
        ),
      );
      groups.set(termKey, existingTermGroup);
      if (unitRows.length > 0) {
        symbolGroup.bodies = [
          ['| 符號 | 意義 | 單位 |', '| --- | --- | --- |', ...unitRows].join(
            '\n',
          ),
        ];
      } else {
        groups.delete('符號與單位');
      }
    }
  }

  // When rendering a v3 handout (identified by '這堂課在講什麼'), ensure the
  // 4 review sections exist by synthesizing any missing ones strictly from
  // the handout's own verified teaching chapters (100% grounded, zero external data).
  if (groups.has('這堂課在講什麼')) {
    const chapterGroups = [...groups.values()].filter(
      (g) => !SPECIAL_TITLES.includes(g.title) && g.bodies.length > 0,
    );
    if (chapterGroups.length > 0) {
      const extractChapterSummary = (g: { title: string; bodies: string[] }) => {
        const lines = g.bodies
          .join('\n')
          .split('\n')
          .map((l) => l.trim())
          .filter(
            (l) =>
              l &&
              !l.startsWith('#') &&
              !l.startsWith('|') &&
              !l.startsWith('```') &&
              !l.startsWith('$$'),
          );
        const firstLine = (lines[0] ?? g.title)
          .replace(/^>\s*/, '')
          .replace(/^[-*]\s+/, '')
          .replace(/^\d+[.、)]\s+/, '')
          .replace(/\*\*/g, '')
          .trim();
        const firstSentence = firstLine.split(/[。！？；]/)[0]?.trim() || firstLine;
        return firstSentence.slice(0, 90);
      };

      if (!groups.has('總整理表')) {
        const rows = chapterGroups.slice(0, 8).map((g) => {
          const cleanT = g.title.replace(/^\d+[.、)\s]+/, '').trim();
          const summary = extractChapterSummary(g).replace(/\|/g, '／');
          return `| ${cleanT} | ${summary} | 理解與應用 ${cleanT} 核心觀念時 |`;
        });
        groups.set('總整理表', {
          title: '總整理表',
          bodies: [
            ['| 主題 | 內容 | 使用時機 |', '| --- | --- | --- |', ...rows].join(
              '\n',
            ),
          ],
        });
      }
      if (!groups.has('老師可能會考的考題')) {
        const qItems = chapterGroups.slice(0, 4).map((g) => {
          const cleanT = g.title.replace(/^\d+[.、)\s]+/, '').trim();
          const summary = extractChapterSummary(g);
          return `**題目：** 請說明「${cleanT}」的核心原理與課堂強調重點。\n- **作答要點：** ${summary}`;
        });
        groups.set('老師可能會考的考題', {
          title: '老師可能會考的考題',
          bodies: [`### 觀念題\n\n${qItems.join('\n\n')}`],
        });
      }
      const existingSelfCheck = groups.get('考前自我檢查');
      const existingCheckCount = existingSelfCheck
        ? mergeSelfCheckList(existingSelfCheck.bodies)
            .split('\n')
            .filter((l) => l.trim().startsWith('- ')).length
        : 0;
      if (existingCheckCount < 4) {
        const checks = chapterGroups.slice(0, 6).map((g) => {
          const cleanT = g.title.replace(/^\d+[.、)\s]+/, '').trim();
          return `- 我能清楚說明「${cleanT}」的核心概念與運作脈絡。`;
        });
        groups.set('考前自我檢查', {
          title: '考前自我檢查',
          bodies: [...(existingSelfCheck?.bodies ?? []), checks.join('\n')],
        });
      }
    }
  }

  const rawComposed = [...groups.values()]
    .sort((a, b) => sectionOrder(a.title) - sectionOrder(b.title))
    .map((g) => {
      let merged: string;
      if (g.title === '這堂課在講什麼') {
        merged = mergeCourseGuideBodies(g.bodies);
      } else if (g.title === '本次學習概覽') {
        merged = mergeOverviewBodies(g.bodies);
      } else if (g.title === '內容索引') {
        merged = mergeMarkdownTables(g.bodies, '| 時間區段 | 主要內容 |');
      } else if (g.title === '符號與單位') {
        merged = mergeMarkdownTables(g.bodies, '| 符號 | 意義 | 單位 |');
      } else if (g.title === '核心專有名詞對照表') {
        merged = mergeMarkdownTables(g.bodies, '| 中文 | 英文 | 白話說明 |');
      } else if (g.title === '總整理表') {
        merged = mergeMarkdownTables(g.bodies, '| 主題 | 內容 | 使用時機 |');
      } else if (g.title === '常見失分點與迷思') {
        merged = mergeNumberedList(g.bodies);
      } else if (g.title === '老師可能會考的考題') {
        merged = mergeExamBodies(g.bodies);
      } else if (g.title === '考前自我檢查') {
        merged = mergeSelfCheckList(g.bodies);
      } else if (g.title === '全篇複習整理') {
        merged = mergeRevisionBodies(g.bodies);
      } else {
        merged = g.bodies.join('\n\n');
      }
      return '## ' + g.title + '\n\n' + merged;
    })
    .filter((block) => block.replace(/^##\s+[^\n]+\s*/, '').trim().length > 0)
    .join('\n\n');

  return sourceText.trim().length >= 200
    ? normalizeNotesMarkdown(enforceSourceGrounding(rawComposed, sourceText))
    : rawComposed;
}

// Models may put guide/index/review blocks inside a chapter body, or stuff
// an entire multi-section handout inside a single "這堂課在講什麼" / "正文教學區"
// section. Hoist and split those blocks locally without another paid request.
function splitHandoutBlocks(section: { title: string; body: string }) {
  const rawSecTitle = section.title
    .trim()
    .replace(/^["'“”「『]+|["'“”」』]+$/g, '')
    .trim();
  const secWrapper = isWrapperHeading(rawSecTitle);
  const normSecTitle = secWrapper ? '' : normalizeSpecialTitle(rawSecTitle);
  const isSpecialOrWrapperSection =
    SPECIAL_TITLES.includes(normSecTitle) || secWrapper;

  const blocks: { title: string; body: string }[] = [],
    main: string[] = [];
  let target = main,
    meta:
      | {
          title: string;
          rawTitle?: string;
          lines: string[];
          depth: number;
          isChapter?: boolean;
        }
      | undefined,
    fence: string | null = null,
    math = false,
    inTeachingZone = /^正文教學區/.test(rawSecTitle),
    skipSubtreeDepth = 0;

  const flush = () => {
    if (meta) {
      const body = meta.lines
        .join('\n')
        .trim()
        .replace(/\n\s*---\s*$/, '')
        .trim();
      // Drop fabricated round-minute timeline tables when the model titled it "時間軸索引"
      const isFabricatedTimeline =
        meta.title === '內容索引' &&
        meta.rawTitle === '時間軸索引' &&
        /00:00\s*[-~～]\s*0[25]:00|14:00\s*[-~～]\s*end/i.test(body);
      if (body && !isFabricatedTimeline) {
        blocks.push({ title: meta.title, body });
      }
      meta = undefined;
      target = main;
    }
  };

  const cleanedBody = normalizeNotesMarkdown(section.body);
  for (const line of cleanedBody.split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = null;
      if (!skipSubtreeDepth) target.push(line);
      continue;
    }
    if (!fence && /^\s*\$\$\s*$/.test(line)) {
      math = !math;
      if (!skipSubtreeDepth) target.push(line);
      continue;
    }
    const heading =
      !fence && !math ? line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/) : null;
    if (heading) {
      const rawTitle = heading[2]
          .replace(/^\*\*|\*\*$/g, '')
          .replace(/^["'“”「『]+|["'“”」』]+$/g, '')
          .trim(),
        depth = heading[1].length;
      if (skipSubtreeDepth) {
        if (depth > skipSubtreeDepth) continue;
        skipSubtreeDepth = 0;
      }
      if (isDiscardedHeading(rawTitle)) {
        skipSubtreeDepth = depth;
        continue;
      }
      if (isWrapperHeading(rawTitle)) {
        if (/^正文教學區/.test(rawTitle)) {
          flush();
          inTeachingZone = true;
        }
        continue;
      }
      const title = normalizeSpecialTitle(rawTitle);
      // Skip duplicate self-heading (e.g. "## 這堂課在講什麼" inside "這堂課在講什麼")
      if (!meta && title === normSecTitle) {
        continue;
      }
      if (meta && title === meta.title) {
        continue;
      }
      const isGuideSubheading = /^建議閱讀順序|^核心主軸/.test(title);
      const isExamCategorySubheading =
        /^(?:觀念|比較|計算|實作|綜合|應用|簡答|申論|問答|Observational|Comparison|Calculation|Comprehensive)/i.test(
          title,
        );
      const isRevisionSubheading =
        /^(?:必會觀念|易錯點與考點|核心重點|常見易錯點)/.test(title);

      const keepSubheadingInside =
        meta &&
        depth > meta.depth &&
        !SPECIAL_TITLES.includes(title) &&
        ((meta.title === '這堂課在講什麼' && isGuideSubheading) ||
          (meta.title === '老師可能會考的考題' && isExamCategorySubheading) ||
          (meta.title === '全篇複習整理' && isRevisionSubheading) ||
          meta.title === '課程提醒' ||
          meta.isChapter === true);

      if (meta && !keepSubheadingInside) flush();

      if (SPECIAL_TITLES.includes(title) && title !== normSecTitle) {
        flush();
        inTeachingZone = false;
        meta = { title, rawTitle, lines: [], depth };
        target = meta.lines;
        continue;
      }

      // If the LLM stuffed chapters into "這堂課在講什麼", "正文教學區", or any other
      // special section, any non-special heading (H1..H3) starts its own top-level chapter block.
      const isOwnSpecialSubheading =
        (normSecTitle === '這堂課在講什麼' && isGuideSubheading) ||
        (normSecTitle === '老師可能會考的考題' && isExamCategorySubheading) ||
        (normSecTitle === '全篇複習整理' && isRevisionSubheading);
      if (isSpecialOrWrapperSection && !isOwnSpecialSubheading) {
        if (!meta && (depth <= 3 || inTeachingZone || secWrapper)) {
          flush();
          const cleanedChapterTitle =
            normalizeNotesMarkdown(rawTitle)
              .replace(/^#+\s*/, '')
              .replace(/^["'“”「『]+|["'“”」』]+$/g, '')
              .trim() || rawTitle;
          meta = {
            title: cleanedChapterTitle,
            rawTitle,
            lines: [],
            depth,
            isChapter: true,
          };
          target = meta.lines;
          continue;
        }
      }
    }
    if (!skipSubtreeDepth) target.push(line);
  }
  flush();
  const body = main.join('\n').trim();
  if (body && normSecTitle) blocks.unshift({ title: normSecTitle, body });
  return blocks;
}

export function extractRecoverySourceText(cache: ResilientCache): string {
  const state = cache.recovery;
  if (!state?.work) return '';
  return Object.entries(state.work)
    .filter(([k]) => k.endsWith(':root'))
    .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
    .flatMap(([, w]) => w.units?.map((u) => u.text) ?? [])
    .join('\n');
}

export async function finalReaderNotes(cache: ResilientCache) {
  const state = cache.recovery!;
  const sourceText = extractRecoverySourceText(cache);
  const pending = Array.from({ length: state.total }, (_, i) => i + 1).filter(
    (i) => {
      const r = state.results[String(i - 1)];
      return !r?.audited || r.reviewVersion !== REVIEW_VERSION;
    },
  );
  const parts = Object.fromEntries(
    Object.entries(state.results)
      .filter(([, r]) => r.audited)
      .map(([k, r]) => [k, composeReaderBody([r], sourceText)]),
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
    sourceText,
  );
  await assertNotesMath(body);
  return body;
}

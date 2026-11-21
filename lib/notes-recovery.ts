import { normalizeNotesMarkdown, assertReadableNotes } from './iai-workflow.ts';

/** Layout recovery only: never invent an equation, missing code or conclusion. */
export async function recoverNotesLayout(input: string) {
  const repairs: string[] = [];
  let value = normalizeNotesMarkdown(input);
  let fence: string | null = null;
  let mathOpen = false;
  const lines: string[] = [];
  for (const line of value.split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (marker && !mathOpen) {
      if (!fence) fence = marker[1];
      else if (
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = null;
    }
    if (!fence && line.trim() === '$$') mathOpen = !mathOpen;
    // A heading after an unclosed formula is prose, not part of its equation.
    if (!fence && mathOpen && /^\s{0,3}#{1,6}\s/.test(line)) {
      lines.push('$$', '');
      mathOpen = false;
      repairs.push('補齊公式區塊界線');
    }
    lines.push(line);
  }
  if (fence) {
    lines.push(fence);
    repairs.push('補齊程式區塊界線（未補寫程式內容）');
  }
  if (mathOpen) {
    lines.push('$$');
    repairs.push('補齊公式區塊界線');
  }
  value = lines.join('\n');

  const [
    { unified },
    { default: parse },
    { default: math },
    { default: gfm },
    { default: katex },
  ] = await Promise.all([
    import('unified'),
    import('remark-parse'),
    import('remark-math'),
    import('remark-gfm'),
    import('katex'),
  ]);
  const tree = unified().use(parse).use(gfm).use(math).parse(value);
  const replacements: { start: number; end: number; text: string }[] = [];
  function visit(node: {
    type: string;
    value?: string;
    position?: { start: { offset?: number }; end: { offset?: number } };
    children?: typeof tree.children;
  }) {
    if ((node.type === 'math' || node.type === 'inlineMath') && node.value) {
      try {
        if (
          /\\{3,}|\\{2,}[A-Za-z]|(?<!\\)\b(?:frac|sqrt|text|begin|end)\s*\{/.test(
            node.value,
          )
        )
          throw new Error('damaged command');
        katex.renderToString(node.value, {
          throwOnError: true,
          trust: false,
          strict: 'ignore',
        });
      } catch {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (start !== undefined && end !== undefined) {
          // Preserve the exact expression as literal text, not guessed mathematics.
          const ticks = '`'.repeat(
            Math.max(
              1,
              ...(node.value.match(/`+/g) ?? []).map((s) => s.length + 1),
            ),
          );
          const expression = node.value.replace(/\r?\n/g, ' ');
          replacements.push({
            start,
            end,
            text:
              node.type === 'math'
                ? `\n${ticks} ${expression} ${ticks}\n`
                : `${ticks} ${expression} ${ticks}`,
          });
          repairs.push('無法排版的公式保留為原式文字，未推測改寫');
        }
      }
    }
    node.children?.forEach(visit);
  }
  visit(tree);
  for (const item of replacements.sort((a, b) => b.start - a.start))
    value = value.slice(0, item.start) + item.text + value.slice(item.end);
  assertReadableNotes(value);
  return { text: value.trim(), repairs: [...new Set(repairs)] };
}

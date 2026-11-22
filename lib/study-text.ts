import { Converter } from 'opencc-js/cn2t';

let syncConverter: ((text: string) => string) | undefined;

export function toTraditionalStudyTextSync(value: string) {
  syncConverter ??= Converter({ from: 'cn', to: 'tw' });
  const convert = syncConverter;
  const convertProse = (line: string) => {
    let cursor = 0;
    let result = '';
    for (const span of line.matchAll(/(`+)(.*?)\1/g)) {
      result += convert(line.slice(cursor, span.index)) + span[0];
      cursor = span.index! + span[0].length;
    }
    return result + convert(line.slice(cursor));
  };
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
      // English terminology, LaTeX commands, and complete programs stay intact.
      return fence ? line : convertProse(line);
    })
    .join('\n');
}

export async function toTraditionalStudyText(value: string) {
  return toTraditionalStudyTextSync(value);
}

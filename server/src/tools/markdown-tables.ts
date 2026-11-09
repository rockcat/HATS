/**
 * Reads GitHub-style pipe tables out of a markdown document. Each table keeps
 * the text between it and the table before it, so a caller can see which
 * heading or tab label it sits under.
 */

export interface MarkdownTable {
  headers: string[];
  rows: string[][];
  /** Text between the previous table (or the start) and this one. */
  preceding: string;
}

const SEPARATOR = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

export function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

export function parseMarkdownTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split(/\r?\n/);
  const tables: MarkdownTable[] = [];
  let preceding: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];
    if (line.trim().startsWith('|') && next !== undefined && SEPARATOR.test(next.trim())) {
      const headers = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(splitRow(lines[i++]!));
      i--;
      tables.push({ headers, rows, preceding: preceding.join('\n') });
      preceding = [];
    } else {
      preceding.push(line);
    }
  }
  return tables;
}

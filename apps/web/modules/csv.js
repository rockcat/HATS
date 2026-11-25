// ── Reading CSV, for previews ────────────────────────────────────────────────
//
// Quoted fields, doubled quotes inside them, commas and line breaks within
// quotes, and \r\n line ends. No imports and no DOM, so it is directly testable.

/**
 * Rows of fields, at most `maxRows` of them.
 * @returns {{ rows: string[][], total: number }} total counts every row, shown or not
 */
export function parseCsv(text, maxRows = Infinity) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let total = 0;
  const endRow = () => {
    row.push(field);
    field = '';
    if (row.length > 1 || row[0] !== '') {
      total++;
      if (rows.length < maxRows) rows.push(row);
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') endRow();
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) endRow();
  return { rows, total };
}

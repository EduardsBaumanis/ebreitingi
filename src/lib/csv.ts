/**
 * Minimal CSV parser: supports a chosen delimiter, "quoted" fields with "" escapes,
 * quoted newlines, CRLF/LF line endings and a leading UTF-8 BOM. Blank lines are skipped.
 */
export function parseCsv(text: string, delimiter = ';'): string[][] {
  const input = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const endRow = () => {
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    row = [];
    field = '';
  };

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      endRow();
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

/** Picks ";" , "\t" or "," based on the first line. */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts = [';', '\t', ','].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ';';
}

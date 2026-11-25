// Bulk teacher import (CMS). Format: full_name;institution_reg_number;subjects
// The preview and the final import both call analyzeImport() on the same text, so what the
// admin confirmed is re-validated against the database at import time.

import { detectDelimiter, parseCsv } from './csv';
import { normalizeForSearch } from './slug';
import { cleanLine, NAME_MAX, SUBJECTS_MAX, teacherNameError } from './validate';

export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_BYTES = 1_000_000;

export type RowStatus = 'ok' | 'warning' | 'skip' | 'error';

export interface ImportRow {
  line: number;
  fullName: string;
  regNumber: string;
  subjects: string | null;
  institution: { id: number; name: string } | null;
  status: RowStatus;
  messages: string[];
}

export interface ImportAnalysis {
  rows: ImportRow[];
  counts: Record<RowStatus, number>;
  /** Set when the whole file is unusable. */
  fatal: string | null;
}

const HEADER_WORDS = ['full_name', 'name', 'vards', 'vārds', 'vards uzvards', 'vārds uzvārds', 'pedagogs'];

function emptyAnalysis(fatal: string | null): ImportAnalysis {
  return { rows: [], counts: { ok: 0, warning: 0, skip: 0, error: 0 }, fatal };
}

export async function analyzeImport(db: D1Database, text: string): Promise<ImportAnalysis> {
  if (!text.trim()) return emptyAnalysis('Fails ir tukšs.');
  if (new TextEncoder().encode(text).length > IMPORT_MAX_BYTES) {
    return emptyAnalysis('Fails ir pārāk liels (maksimums 1 MB).');
  }

  const parsed = parseCsv(text, detectDelimiter(text));
  const hasHeader = parsed.length > 0 && HEADER_WORDS.includes(normalizeForSearch(parsed[0][0] ?? ''));
  const dataRows = hasHeader ? parsed.slice(1) : parsed;
  if (!dataRows.length) return emptyAnalysis('Failā nav datu rindu.');
  if (dataRows.length > IMPORT_MAX_ROWS) {
    return emptyAnalysis(`Failā ir ${dataRows.length} rindas; vienā reizē var importēt līdz ${IMPORT_MAX_ROWS}.`);
  }

  const rows: ImportRow[] = dataRows.map((cells, i) => {
    const row: ImportRow = {
      line: i + 1 + (hasHeader ? 1 : 0),
      fullName: cleanLine(cells[0], NAME_MAX + 1),
      regNumber: (cells[1] ?? '').replace(/\s+/g, ''),
      subjects: cleanLine(cells[2], SUBJECTS_MAX) || null,
      institution: null,
      status: 'ok',
      messages: [],
    };
    const nameError = teacherNameError(row.fullName);
    if (cells.length < 2) {
      row.status = 'error';
      row.messages.push('Rindā jābūt vismaz 2 kolonnām: vārds; reģistrācijas numurs.');
    } else if (nameError) {
      row.status = 'error';
      row.messages.push(nameError);
    } else if (!/^\d{6,12}$/.test(row.regNumber)) {
      row.status = 'error';
      row.messages.push('Nederīgs reģistrācijas numurs.');
    }
    return row;
  });

  const candidates = rows.filter((r) => r.status !== 'error');

  // Institutions by registration number
  const regNumbers = [...new Set(candidates.map((r) => r.regNumber))];
  const { results: institutions } = await db
    .prepare(`SELECT id, name, reg_number FROM institutions WHERE reg_number IN (SELECT value FROM json_each(?1))`)
    .bind(JSON.stringify(regNumbers))
    .all<{ id: number; name: string; reg_number: string }>();
  const byReg = new Map(institutions.map((i) => [i.reg_number, i]));
  for (const row of candidates) {
    const inst = byReg.get(row.regNumber);
    if (inst) row.institution = { id: inst.id, name: inst.name };
    else {
      row.status = 'error';
      row.messages.push(`Nezināms reģistrācijas numurs ${row.regNumber}.`);
    }
  }

  const valid = rows.filter((r) => r.status !== 'error');
  const pairs = valid.map((r) => ({ s: normalizeForSearch(r.fullName), i: r.institution!.id }));

  // Already in the database at the same institution (including removed teachers, which
  // must never be re-created by an import), and same name at other institutions.
  const [existingPairs, existingNames] = await db.batch<{ idx?: number; status?: string; name_search?: string }>([
    db
      .prepare(
        `SELECT CAST(j.key AS INTEGER) AS idx, t.status
           FROM json_each(?1) j
           JOIN teacher_institutions ti ON ti.institution_id = json_extract(j.value, '$.i')
           JOIN teachers t ON t.id = ti.teacher_id AND t.name_search = json_extract(j.value, '$.s')`,
      )
      .bind(JSON.stringify(pairs)),
    db
      .prepare(
        `SELECT DISTINCT name_search FROM teachers
          WHERE name_search IN (SELECT json_extract(value, '$.s') FROM json_each(?1))`,
      )
      .bind(JSON.stringify(pairs)),
  ]);

  const existingByIdx = new Map<number, string>();
  for (const r of existingPairs.results) existingByIdx.set(r.idx!, r.status!);
  const namesInDb = new Set(existingNames.results.map((r) => r.name_search!));

  const seenPairs = new Set<string>();
  const nameInstitutions = new Map<string, Set<number>>();
  valid.forEach((row, idx) => {
    const key = `${pairs[idx].s}|${pairs[idx].i}`;
    const existingStatus = existingByIdx.get(idx);
    if (existingStatus === 'removed') {
      row.status = 'skip';
      row.messages.push('Šis pedagogs dzēsts pēc pieprasījuma, tāpēc netiks importēts atkārtoti.');
    } else if (existingStatus) {
      row.status = 'skip';
      row.messages.push('Pedagogs ar šādu vārdu šajā iestādē jau ir.');
    } else if (seenPairs.has(key)) {
      row.status = 'skip';
      row.messages.push('Rinda failā atkārtojas.');
    } else if (namesInDb.has(pairs[idx].s)) {
      row.status = 'warning';
      row.messages.push('Pedagogs ar šādu vārdu jau ir citā iestādē. Tiks izveidots jauns ieraksts; ja tā ir viena persona, ierakstus vēlāk var apvienot.');
    }
    seenPairs.add(key);
    const set = nameInstitutions.get(pairs[idx].s) ?? new Set<number>();
    set.add(pairs[idx].i);
    nameInstitutions.set(pairs[idx].s, set);
  });

  // Same name at several institutions within the file
  valid.forEach((row, idx) => {
    if (row.status === 'ok' && (nameInstitutions.get(pairs[idx].s)?.size ?? 0) > 1) {
      row.status = 'warning';
      row.messages.push('Šis vārds failā ir vairākās iestādēs. Katrai tiks izveidots atsevišķs ieraksts.');
    }
  });

  const counts: Record<RowStatus, number> = { ok: 0, warning: 0, skip: 0, error: 0 };
  for (const row of rows) counts[row.status]++;
  return { rows, counts, fatal: null };
}

/** Rows that will be created on confirm. */
export function importableRows(analysis: ImportAnalysis): ImportRow[] {
  return analysis.rows.filter((r) => r.status === 'ok' || r.status === 'warning');
}

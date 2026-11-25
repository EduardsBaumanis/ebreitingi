import { likeClause, likeTerms } from './search';
import { normalizeForSearch } from './slug';
import { veidsFromSlug, veidsInfo, veidsOrder, type VeidsInfo } from './veidi';

export interface InstitutionRow {
  id: number;
  name: string;
  slug: string;
  veids: string;
  tips: string | null;
  location: string | null;
  accredited: number;
  liquidated: number;
  avg_score: number | null;
  rated_teachers: number;
  review_count: number;
}

export interface InstitutionDetail extends InstitutionRow {
  reg_number: string;
  founder: string | null;
  subordination: string | null;
}

export const SORTS = {
  // Only offered when there is a search query; see relevanceOrder().
  atbilstiba: { label: 'Atbilstība', sql: 'name_search ASC' },
  nosaukums: { label: 'Nosaukums (A–Ž)', sql: 'name_search ASC' },
  vertejums: { label: 'Augstākais vērtējums', sql: 'avg_score DESC NULLS LAST, review_count DESC, name_search ASC' },
  atsauksmes: { label: 'Visvairāk atsauksmju', sql: 'review_count DESC, name_search ASC' },
} as const;
export type SortKey = keyof typeof SORTS;

export const PAGE_SIZE = 25;

const LIST_COLUMNS =
  'id, name, slug, veids, tips, location, accredited, liquidated, avg_score, rated_teachers, review_count';

export interface ListParams {
  q: string;
  veids: VeidsInfo | null;
  tips: string | null;
  vieta: string | null;
  sort: SortKey;
  page: number;
}

export interface FilterOptions {
  veidi: { info: VeidsInfo; count: number }[];
  tipi: { value: string; count: number }[];
  vietas: { value: string; count: number }[];
}

/**
 * Reads and validates list filters from the URL. Unknown values are dropped rather than
 * producing an error page, so old or hand-edited links still work.
 */
export function parseListParams(url: URL, options: FilterOptions): ListParams {
  const p = url.searchParams;
  const q = (p.get('q') ?? '').trim().slice(0, 100);
  const veids = veidsFromSlug(p.get('veids'));
  const tipsRaw = p.get('tips');
  const tips = tipsRaw && options.tipi.some((t) => t.value === tipsRaw) ? tipsRaw : null;
  const vietaRaw = p.get('vieta');
  const vieta = vietaRaw && options.vietas.some((v) => v.value === vietaRaw) ? vietaRaw : null;
  const sortRaw = p.get('kartot') ?? '';
  let sort: SortKey = sortRaw in SORTS ? (sortRaw as SortKey) : q ? 'atbilstiba' : 'nosaukums';
  if (sort === 'atbilstiba' && !q) sort = 'nosaukums';
  const pageNum = Number.parseInt(p.get('lapa') ?? '1', 10);
  const page = Number.isFinite(pageNum) && pageNum > 0 ? Math.min(pageNum, 1000) : 1;
  return { q, veids, tips, vieta, sort, page };
}

/**
 * Filter dropdown contents. The type list ("Tips") is narrowed to the selected Veids, so
 * users don't see school types that can't match.
 */
export async function getFilterOptions(db: D1Database, veidsValue: string | null): Promise<FilterOptions> {
  const [veidi, tipi, vietas] = await db.batch<{ value: string; count: number }>([
    db.prepare(
      `SELECT veids AS value, COUNT(*) AS count FROM institutions WHERE hidden = 0 GROUP BY veids`,
    ),
    db
      .prepare(
        `SELECT tips AS value, COUNT(*) AS count FROM institutions
          WHERE hidden = 0 AND tips IS NOT NULL AND (?1 IS NULL OR veids = ?1)
          GROUP BY tips ORDER BY tips`,
      )
      .bind(veidsValue),
    db.prepare(
      `SELECT location AS value, COUNT(*) AS count FROM institutions
        WHERE hidden = 0 AND location IS NOT NULL
        GROUP BY location ORDER BY location`,
    ),
  ]);

  return {
    veidi: veidi.results
      .map((r) => ({ info: veidsInfo(r.value), count: r.count }))
      .sort((a, b) => veidsOrder(a.info) - veidsOrder(b.info)),
    tipi: tipi.results,
    vietas: vietas.results,
  };
}

export async function listInstitutions(
  db: D1Database,
  params: ListParams,
): Promise<{ rows: InstitutionRow[]; total: number; totalPages: number }> {
  const where: string[] = ['hidden = 0'];
  const binds: (string | number)[] = [];

  const terms = likeTerms(params.q);
  if (terms.length) {
    const clause = likeClause('name_search', terms);
    where.push(clause.sql);
    binds.push(...clause.binds);
  }
  if (params.veids) {
    where.push('veids = ?');
    binds.push(params.veids.value);
  }
  if (params.tips) {
    where.push('tips = ?');
    binds.push(params.tips);
  }
  if (params.vieta) {
    where.push('location = ?');
    binds.push(params.vieta);
  }

  const whereSql = where.join(' AND ');
  const offset = (params.page - 1) * PAGE_SIZE;

  let orderSql: string = SORTS[params.sort].sql;
  const orderBinds: string[] = [];
  if (params.sort === 'atbilstiba' && terms.length) {
    const relevance = relevanceOrder(params.q);
    orderSql = relevance.sql;
    orderBinds.push(...relevance.binds);
  }

  const [countResult, rowsResult] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS total FROM institutions WHERE ${whereSql}`).bind(...binds),
    db
      .prepare(
        `SELECT ${LIST_COLUMNS} FROM institutions WHERE ${whereSql}
          ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
      )
      .bind(...binds, ...orderBinds, PAGE_SIZE, offset),
  ]);

  const total = (countResult.results[0] as { total: number }).total;
  return {
    rows: rowsResult.results as unknown as InstitutionRow[],
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/**
 * Search ranking: names starting with the whole query first, then names where the first
 * word of the query starts a word, then shorter names (so "Latvijas Universitāte" beats
 * its many "Latvijas Universitātes … koledža" branches), then alphabetical.
 */
function relevanceOrder(query: string): { sql: string; binds: string[] } {
  const normalized = normalizeForSearch(query);
  const escape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  const firstWord = normalized.split(' ')[0] ?? '';
  return {
    sql: `(name_search LIKE ? ESCAPE '\\') DESC,
          (' ' || name_search LIKE ? ESCAPE '\\') DESC,
          LENGTH(name_search) ASC,
          name_search ASC`,
    binds: [`${escape(normalized)}%`, `% ${escape(firstWord)}%`],
  };
}

export async function getInstitutionBySlug(db: D1Database, slug: string): Promise<InstitutionDetail | null> {
  return db
    .prepare(
      `SELECT ${LIST_COLUMNS}, reg_number, founder, subordination
         FROM institutions WHERE slug = ?1 AND hidden = 0`,
    )
    .bind(slug)
    .first<InstitutionDetail>();
}

export interface InstitutionTeacher {
  id: number;
  full_name: string;
  slug: string;
  subjects: string | null;
  avg_score: number | null;
  review_count: number;
}

/** Active teachers at an institution, scored only from reviews given for this institution. */
export async function getInstitutionTeachers(db: D1Database, institutionId: number): Promise<InstitutionTeacher[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.full_name, t.slug, ti.subjects,
              AVG(r.overall_score) AS avg_score,
              COUNT(r.id)          AS review_count
         FROM teacher_institutions ti
         JOIN teachers t ON t.id = ti.teacher_id AND t.status = 'active'
         LEFT JOIN reviews r ON r.teacher_id = t.id
                            AND r.institution_id = ti.institution_id
                            AND r.status = 'approved'
        WHERE ti.institution_id = ?1
        GROUP BY t.id
        ORDER BY t.name_search`,
    )
    .bind(institutionId)
    .all<InstitutionTeacher>();
  return results;
}

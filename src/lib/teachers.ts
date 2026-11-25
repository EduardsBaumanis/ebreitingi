import { likeClause, likeTerms } from './search';
import { normalizeForSearch, slugify } from './slug';

export type TeacherStatus = 'pending' | 'active' | 'hidden' | 'removed';

export const STATUS_LABELS: Record<TeacherStatus, string> = {
  pending: 'Gaida apstiprinājumu',
  active: 'Aktīvs',
  hidden: 'Paslēpts',
  removed: 'Dzēsts (pieprasījums)',
};

export const SOURCE_LABELS: Record<string, string> = {
  admin: 'Pievienoja administrators',
  import: 'Importēts',
  suggested: 'Ieteica skolēns',
};

// ---------------------------------------------------------------------------
// Search (public)
// ---------------------------------------------------------------------------

export interface TeacherSearchRow {
  id: number;
  full_name: string;
  slug: string;
  avg_score: number | null;
  review_count: number;
  /** Institution names joined with " · " */
  institutions: string | null;
}

/** Active teachers whose name matches every word of the query. */
export async function searchTeachers(db: D1Database, query: string, limit = 20): Promise<TeacherSearchRow[]> {
  const terms = likeTerms(query);
  if (!terms.length) return [];
  const clause = likeClause('t.name_search', terms);
  const { results } = await db
    .prepare(
      `SELECT t.id, t.full_name, t.slug, t.avg_score, t.review_count,
              (SELECT GROUP_CONCAT(i.name, ' · ')
                 FROM teacher_institutions ti
                 JOIN institutions i ON i.id = ti.institution_id AND i.hidden = 0
                WHERE ti.teacher_id = t.id) AS institutions
         FROM teachers t
        WHERE t.status = 'active' AND ${clause.sql}
        ORDER BY t.review_count DESC, t.name_search
        LIMIT ?`,
    )
    .bind(...clause.binds, limit)
    .all<TeacherSearchRow>();
  return results;
}

// ---------------------------------------------------------------------------
// Public teacher page
// ---------------------------------------------------------------------------

export interface TeacherPublic {
  id: number;
  full_name: string;
  slug: string;
  avg_score: number | null;
  review_count: number;
}

export async function getActiveTeacherBySlug(db: D1Database, slug: string): Promise<TeacherPublic | null> {
  return db
    .prepare(`SELECT id, full_name, slug, avg_score, review_count FROM teachers WHERE slug = ?1 AND status = 'active'`)
    .bind(slug)
    .first<TeacherPublic>();
}

export interface TeacherInstitution {
  id: number;
  name: string;
  slug: string;
  subjects: string | null;
  avg_score: number | null;
  review_count: number;
}

export interface CriterionAverage {
  id: number;
  label: string;
  description: string | null;
  avg_score: number | null;
  count: number;
}

export interface TagCount {
  id: number;
  label: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  count: number;
}

/** Everything on the teacher page except the review list, in one round trip. */
export async function getTeacherSummary(db: D1Database, teacherId: number) {
  const [institutions, criteria, tags, periods] = await db.batch([
    // Linked institutions, plus any institution with approved reviews (in case a link was removed).
    db
      .prepare(
        `SELECT i.id, i.name, i.slug, ti.subjects,
                (SELECT AVG(overall_score) FROM reviews r
                  WHERE r.teacher_id = ?1 AND r.institution_id = i.id AND r.status = 'approved') AS avg_score,
                (SELECT COUNT(*) FROM reviews r
                  WHERE r.teacher_id = ?1 AND r.institution_id = i.id AND r.status = 'approved') AS review_count
           FROM institutions i
           LEFT JOIN teacher_institutions ti ON ti.institution_id = i.id AND ti.teacher_id = ?1
          WHERE i.hidden = 0
            AND (ti.teacher_id IS NOT NULL
                 OR i.id IN (SELECT institution_id FROM reviews WHERE teacher_id = ?1 AND status = 'approved'))
          ORDER BY review_count DESC, i.name_search`,
      )
      .bind(teacherId),
    db
      .prepare(
        `SELECT c.id, c.label, c.description, AVG(rs.score) AS avg_score, COUNT(rs.score) AS count
           FROM criteria c
           LEFT JOIN review_scores rs
                  ON rs.criterion_id = c.id
                 AND rs.review_id IN (SELECT id FROM reviews WHERE teacher_id = ?1 AND status = 'approved')
          WHERE c.active = 1
          GROUP BY c.id
          ORDER BY c.sort_order, c.id`,
      )
      .bind(teacherId),
    db
      .prepare(
        `SELECT t.id, t.label, t.sentiment, COUNT(*) AS count
           FROM review_tags rt
           JOIN tags t    ON t.id = rt.tag_id
           JOIN reviews r ON r.id = rt.review_id AND r.status = 'approved'
          WHERE r.teacher_id = ?1
          GROUP BY t.id
          ORDER BY count DESC, t.sort_order`,
      )
      .bind(teacherId),
    db
      .prepare(
        `SELECT DISTINCT period FROM reviews
          WHERE teacher_id = ?1 AND status = 'approved' AND period IS NOT NULL
          ORDER BY period DESC`,
      )
      .bind(teacherId),
  ]);

  return {
    institutions: institutions.results as unknown as TeacherInstitution[],
    criteria: criteria.results as unknown as CriterionAverage[],
    tags: tags.results as unknown as TagCount[],
    periods: (periods.results as { period: string }[]).map((p) => p.period),
  };
}

export interface PublicReview {
  id: number;
  overall_score: number;
  subject: string | null;
  period: string | null;
  comment: string;
  edited_by_moderator: number;
  created_at: string;
  institution_name: string;
  institution_slug: string;
  scores: { label: string; score: number }[];
  tags: { label: string; sentiment: TagCount['sentiment'] }[];
  reply: { body: string; created_at: string } | null;
}

export const REVIEWS_PAGE_SIZE = 10;

export async function listTeacherReviews(
  db: D1Database,
  teacherId: number,
  filters: { institutionId: number | null; period: string | null; page: number },
): Promise<{ reviews: PublicReview[]; total: number; totalPages: number }> {
  const where = `r.teacher_id = ?1 AND r.status = 'approved'
                 AND (?2 IS NULL OR r.institution_id = ?2)
                 AND (?3 IS NULL OR r.period = ?3)`;
  const binds = [teacherId, filters.institutionId, filters.period];

  const [countRes, rowsRes] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS total FROM reviews r WHERE ${where}`).bind(...binds),
    db
      .prepare(
        `SELECT r.id, r.overall_score, r.subject, r.period, r.comment, r.edited_by_moderator, r.created_at,
                i.name AS institution_name, i.slug AS institution_slug
           FROM reviews r JOIN institutions i ON i.id = r.institution_id
          WHERE ${where}
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT ?4 OFFSET ?5`,
      )
      .bind(...binds, REVIEWS_PAGE_SIZE, (filters.page - 1) * REVIEWS_PAGE_SIZE),
  ]);

  const total = (countRes.results[0] as { total: number }).total;
  const rows = rowsRes.results as unknown as Omit<PublicReview, 'scores' | 'tags' | 'reply'>[];
  const reviews: PublicReview[] = rows.map((r) => ({ ...r, scores: [], tags: [], reply: null }));

  if (reviews.length) {
    const ids = JSON.stringify(reviews.map((r) => r.id));
    const [scores, tags, replies] = await db.batch([
      db
        .prepare(
          `SELECT rs.review_id, c.label, rs.score FROM review_scores rs JOIN criteria c ON c.id = rs.criterion_id
            WHERE rs.review_id IN (SELECT value FROM json_each(?1)) ORDER BY c.sort_order, c.id`,
        )
        .bind(ids),
      db
        .prepare(
          `SELECT rt.review_id, t.label, t.sentiment FROM review_tags rt JOIN tags t ON t.id = rt.tag_id
            WHERE rt.review_id IN (SELECT value FROM json_each(?1)) ORDER BY t.sort_order, t.id`,
        )
        .bind(ids),
      db
        .prepare(
          `SELECT review_id, body, created_at FROM teacher_replies
            WHERE status = 'approved' AND review_id IN (SELECT value FROM json_each(?1))
            ORDER BY created_at`,
        )
        .bind(ids),
    ]);
    const byId = new Map(reviews.map((r) => [r.id, r]));
    for (const s of scores.results as { review_id: number; label: string; score: number }[]) {
      byId.get(s.review_id)?.scores.push({ label: s.label, score: s.score });
    }
    for (const t of tags.results as { review_id: number; label: string; sentiment: TagCount['sentiment'] }[]) {
      byId.get(t.review_id)?.tags.push({ label: t.label, sentiment: t.sentiment });
    }
    for (const rep of replies.results as { review_id: number; body: string; created_at: string }[]) {
      const review = byId.get(rep.review_id);
      if (review && !review.reply) review.reply = { body: rep.body, created_at: rep.created_at };
    }
  }

  return { reviews, total, totalPages: Math.max(1, Math.ceil(total / REVIEWS_PAGE_SIZE)) };
}

// ---------------------------------------------------------------------------
// Creating teachers (CMS, bulk import, and later student suggestions)
// ---------------------------------------------------------------------------

/**
 * Picks unique slugs for new teachers: "anna-berzina", then "anna-berzina-2", "-3", …
 * Considers both existing teachers and the other names in the same request.
 */
export async function uniqueSlugs(db: D1Database, names: string[]): Promise<string[]> {
  const bases = names.map((n) => slugify(n) || 'pedagogs');
  const distinct = [...new Set(bases)];
  // Slugs still used by redirects of merged teachers are taken too.
  const { results } = await db
    .prepare(
      `SELECT slug FROM (SELECT slug FROM teachers UNION ALL SELECT slug FROM teacher_slug_redirects) s
        WHERE EXISTS (SELECT 1 FROM json_each(?1) j WHERE s.slug = j.value OR s.slug LIKE j.value || '-%')`,
    )
    .bind(JSON.stringify(distinct))
    .all<{ slug: string }>();
  const taken = new Set(results.map((r) => r.slug));

  return bases.map((base) => {
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    return slug;
  });
}

export interface NewTeacher {
  fullName: string;
  institutionId: number;
  subjects: string | null;
}

/**
 * Inserts teachers and their institution links in one transaction. Uses json_each so the
 * whole list is a single bound parameter (D1 allows at most 100 parameters per statement).
 */
export async function createTeachers(
  db: D1Database,
  teachers: NewTeacher[],
  options: NewTeacherOptions,
): Promise<string[]> {
  if (!teachers.length) return [];
  const slugs = await uniqueSlugs(db, teachers.map((t) => t.fullName));
  await db.batch(createTeacherStatements(db, teachers, slugs, options));
  return slugs;
}

export interface NewTeacherOptions {
  status: 'active' | 'pending';
  source: 'admin' | 'import' | 'suggested';
}

/** The INSERTs behind createTeachers(), for callers that add more statements to the same batch. */
export function createTeacherStatements(
  db: D1Database,
  teachers: NewTeacher[],
  slugs: string[],
  options: NewTeacherOptions,
): D1PreparedStatement[] {
  const payload = JSON.stringify(
    teachers.map((t, i) => ({
      n: t.fullName,
      s: normalizeForSearch(t.fullName),
      slug: slugs[i],
      i: t.institutionId,
      subj: t.subjects,
    })),
  );
  return [
    db
      .prepare(
        `INSERT INTO teachers (full_name, name_search, slug, status, source)
         SELECT json_extract(value, '$.n'), json_extract(value, '$.s'), json_extract(value, '$.slug'), ?2, ?3
           FROM json_each(?1)`,
      )
      .bind(payload, options.status, options.source),
    db
      .prepare(
        `INSERT INTO teacher_institutions (teacher_id, institution_id, subjects)
         SELECT t.id, json_extract(j.value, '$.i'), json_extract(j.value, '$.subj')
           FROM json_each(?1) j JOIN teachers t ON t.slug = json_extract(j.value, '$.slug')`,
      )
      .bind(payload),
  ];
}

// ---------------------------------------------------------------------------
// Institution picker (CMS forms without JavaScript)
// ---------------------------------------------------------------------------

export interface InstitutionChoice {
  id: number;
  name: string;
  reg_number: string;
  location: string | null;
}

/**
 * Resolves what an admin typed into the institution field: an exact registration number,
 * an exact name, or a search with a single hit. Otherwise returns up to 15 candidates.
 */
export async function resolveInstitution(
  db: D1Database,
  input: string,
): Promise<{ match: InstitutionChoice | null; candidates: InstitutionChoice[] }> {
  const value = input.trim();
  if (!value) return { match: null, candidates: [] };
  const cols = 'id, name, reg_number, location';

  if (/^\d{6,12}$/.test(value)) {
    const byReg = await db.prepare(`SELECT ${cols} FROM institutions WHERE reg_number = ?1`).bind(value).first<InstitutionChoice>();
    if (byReg) return { match: byReg, candidates: [] };
  }

  const normalized = normalizeForSearch(value);
  const exact = await db
    .prepare(`SELECT ${cols} FROM institutions WHERE name_search = ?1 LIMIT 2`)
    .bind(normalized)
    .all<InstitutionChoice>();
  if (exact.results.length === 1) return { match: exact.results[0], candidates: [] };

  const terms = likeTerms(value);
  if (!terms.length) return { match: null, candidates: [] };
  const clause = likeClause('name_search', terms);
  const { results } = await db
    .prepare(`SELECT ${cols} FROM institutions WHERE ${clause.sql} ORDER BY LENGTH(name_search), name_search LIMIT 16`)
    .bind(...clause.binds)
    .all<InstitutionChoice>();
  if (results.length === 1) return { match: results[0], candidates: [] };
  return { match: null, candidates: results.slice(0, 15) };
}

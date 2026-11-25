// Review submission (plan.md §6). Reviews are always saved as 'pending'; nothing about the
// reviewer is stored (no IP, user agent, cookie or account).

import { normalizeForSearch } from './slug';
import { createTeacherStatements, uniqueSlugs } from './teachers';
import { cleanLine, NAME_MAX, teacherNameError } from './validate';

export const COMMENT_MIN = 30;
export const COMMENT_MAX = 2000;
export const SUBJECT_MAX = 100;
export const MAX_TAGS = 5;

export interface Criterion {
  id: number;
  label: string;
  description: string | null;
}

export interface Tag {
  id: number;
  label: string;
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface ReviewFormOptions {
  criteria: Criterion[];
  tags: Tag[];
  periods: string[];
}

export async function getReviewFormOptions(db: D1Database, now = new Date()): Promise<ReviewFormOptions> {
  const [criteria, tags] = await db.batch([
    db.prepare(`SELECT id, label, description FROM criteria WHERE active = 1 ORDER BY sort_order, id`),
    db.prepare(`SELECT id, label, sentiment FROM tags WHERE active = 1 ORDER BY sort_order, id`),
  ]);
  return {
    criteria: criteria.results as unknown as Criterion[],
    tags: tags.results as unknown as Tag[],
    periods: schoolYears(now),
  };
}

/** The current school year (starting 1 September) and the 7 before it: "2026/2027", "2025/2026", … */
export function schoolYears(now: Date, count = 8): string[] {
  const startYear = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return Array.from({ length: count }, (_, i) => `${startYear - i}/${startYear - i + 1}`);
}

export interface ReviewValues {
  scores: Record<number, number>;
  tagIds: number[];
  subject: string;
  period: string;
  comment: string;
  acceptedRules: boolean;
}

export type ReviewErrors = Partial<Record<'scores' | 'tags' | 'subject' | 'period' | 'comment' | 'rules' | 'teacherName' | 'institution' | 'form', string>> & {
  /** Criterion ids that are missing a score */
  missingCriteria?: number[];
};

export function emptyReviewValues(): ReviewValues {
  return { scores: {}, tagIds: [], subject: '', period: '', comment: '', acceptedRules: false };
}

/** Keeps line breaks, trims each line, drops control characters, collapses 3+ blank lines. */
export function cleanComment(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const URL_PATTERN =/(https?:\/\/|www\.|\b[a-z0-9-]+\.(lv|com|net|org|eu|io)\b\/?)/i;

/** Reads and validates the shared review fields. Unknown criteria/tags/periods are rejected. */
export function parseReviewForm(form: FormData, options: ReviewFormOptions): { values: ReviewValues; errors: ReviewErrors } {
  const errors: ReviewErrors = {};
  const values = emptyReviewValues();

  const missing: number[] = [];
  for (const c of options.criteria) {
    const raw = Number(form.get(`score_${c.id}`));
    if (Number.isInteger(raw) && raw >= 1 && raw <= 5) values.scores[c.id] = raw;
    else missing.push(c.id);
  }
  if (missing.length) {
    errors.scores = 'Lūdzu, novērtē visus kritērijus.';
    errors.missingCriteria = missing;
  }

  const allowedTags = new Set(options.tags.map((t) => t.id));
  const tagIds = [...new Set(form.getAll('tags').map(Number))].filter((id) => allowedTags.has(id));
  if (tagIds.length > MAX_TAGS) errors.tags = `Izvēlies ne vairāk kā ${MAX_TAGS} birkas.`;
  values.tagIds = tagIds.slice(0, MAX_TAGS);

  values.subject = cleanLine(form.get('subject'), SUBJECT_MAX + 1);
  if (values.subject.length > SUBJECT_MAX) errors.subject = `Priekšmeta nosaukums nedrīkst būt garāks par ${SUBJECT_MAX} rakstzīmēm.`;
  else if (URL_PATTERN.test(values.subject)) errors.subject = 'Priekšmeta nosaukumā nedrīkst būt saites.';

  const period = String(form.get('period') ?? '');
  if (period && !options.periods.includes(period)) errors.period = 'Izvēlies mācību gadu no saraksta.';
  values.period = options.periods.includes(period) ? period : '';

  // Keep line breaks, trim each line, drop control characters, collapse 3+ blank lines.
  values.comment = cleanComment(form.get('comment'));
  const length = [...values.comment].length;
  if (length < COMMENT_MIN) errors.comment = `Atsauksmei jābūt vismaz ${COMMENT_MIN} rakstzīmes garai (tagad ${length}).`;
  else if (length > COMMENT_MAX) errors.comment = `Atsauksme nedrīkst būt garāka par ${COMMENT_MAX} rakstzīmēm (tagad ${length}).`;
  else if (URL_PATTERN.test(values.comment)) errors.comment = 'Atsauksmē nedrīkst būt saites.';

  values.acceptedRules = form.get('rules') === 'on';
  if (!values.acceptedRules) errors.rules = 'Lai iesniegtu atsauksmi, jāpiekrīt noteikumiem.';

  return { values, errors };
}

export function hasErrors(errors: ReviewErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function overallScore(scores: Record<number, number>): number {
  const list = Object.values(scores);
  return list.reduce((a, b) => a + b, 0) / list.length;
}

/** Validates the name of a teacher a student suggests. */
export function parseSuggestedName(form: FormData): { name: string; error: string | null } {
  const name = cleanLine(form.get('teacher_name'), NAME_MAX + 1);
  return { name, error: teacherNameError(name) };
}

export type SubmitTarget =
  | { kind: 'existing'; teacherId: number; institutionId: number }
  | { kind: 'suggested'; fullName: string; institutionId: number };

export type SubmitResult =
  | { ok: true; teacherSlug: string; teacherIsPublic: boolean }
  | { ok: false; error: string };

/**
 * Saves a pending review (and, for a suggestion, a pending teacher) in one transaction.
 *
 * A suggested name that matches a teacher already at that institution (same normalised name)
 * is attached to that teacher instead of creating a duplicate. Hidden or removed teachers
 * can't be reviewed or re-created this way.
 */
export async function submitReview(db: D1Database, target: SubmitTarget, values: ReviewValues): Promise<SubmitResult> {
  const statements: D1PreparedStatement[] = [];
  let teacherRef: { id: number } | { slug: string };
  let teacherSlug: string;
  let teacherIsPublic: boolean;

  if (target.kind === 'existing') {
    const teacher = await db
      .prepare(
        `SELECT t.slug, t.status FROM teachers t
           JOIN teacher_institutions ti ON ti.teacher_id = t.id AND ti.institution_id = ?2
           JOIN institutions i ON i.id = ti.institution_id AND i.hidden = 0
          WHERE t.id = ?1`,
      )
      .bind(target.teacherId, target.institutionId)
      .first<{ slug: string; status: string }>();
    if (!teacher || teacher.status !== 'active') return { ok: false, error: 'Šo pedagogu pašlaik nevar novērtēt.' };
    teacherRef = { id: target.teacherId };
    teacherSlug = teacher.slug;
    teacherIsPublic = true;
  } else {
    const institution = await db
      .prepare(`SELECT id FROM institutions WHERE id = ?1 AND hidden = 0`)
      .bind(target.institutionId)
      .first<{ id: number }>();
    if (!institution) return { ok: false, error: 'Iestāde nav atrasta.' };

    const existing = await db
      .prepare(
        `SELECT t.id, t.slug, t.status FROM teachers t
           JOIN teacher_institutions ti ON ti.teacher_id = t.id AND ti.institution_id = ?2
          WHERE t.name_search = ?1
          ORDER BY CASE t.status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END
          LIMIT 1`,
      )
      .bind(normalizeForSearch(target.fullName), target.institutionId)
      .first<{ id: number; slug: string; status: string }>();

    if (existing && (existing.status === 'hidden' || existing.status === 'removed')) {
      return { ok: false, error: 'Šo pedagogu pašlaik nevar novērtēt.' };
    }
    if (existing) {
      teacherRef = { id: existing.id };
      teacherSlug = existing.slug;
      teacherIsPublic = existing.status === 'active';
    } else {
      const [slug] = await uniqueSlugs(db, [target.fullName]);
      statements.push(
        ...createTeacherStatements(
          db,
          [{ fullName: target.fullName, institutionId: target.institutionId, subjects: values.subject || null }],
          [slug],
          { status: 'pending', source: 'suggested' },
        ),
      );
      teacherRef = { slug };
      teacherSlug = slug;
      teacherIsPublic = false;
    }
  }

  const key = crypto.randomUUID();
  const reviewInsert =
    'id' in teacherRef
      ? db
          .prepare(
            `INSERT INTO reviews (teacher_id, institution_id, subject, period, comment, overall_score, status, submission_key)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)`,
          )
          .bind(teacherRef.id, target.institutionId, values.subject || null, values.period || null, values.comment, overallScore(values.scores), key)
      : db
          .prepare(
            `INSERT INTO reviews (teacher_id, institution_id, subject, period, comment, overall_score, status, submission_key)
             SELECT id, ?2, ?3, ?4, ?5, ?6, 'pending', ?7 FROM teachers WHERE slug = ?1`,
          )
          .bind(teacherRef.slug, target.institutionId, values.subject || null, values.period || null, values.comment, overallScore(values.scores), key);
  statements.push(reviewInsert);

  statements.push(
    db
      .prepare(
        `INSERT INTO review_scores (review_id, criterion_id, score)
         SELECT r.id, CAST(j.key AS INTEGER), j.value FROM reviews r, json_each(?1) j WHERE r.submission_key = ?2`,
      )
      .bind(JSON.stringify(values.scores), key),
  );
  if (values.tagIds.length) {
    statements.push(
      db
        .prepare(
          `INSERT INTO review_tags (review_id, tag_id)
           SELECT r.id, j.value FROM reviews r, json_each(?1) j WHERE r.submission_key = ?2`,
        )
        .bind(JSON.stringify(values.tagIds), key),
    );
  }

  await db.batch(statements);
  return { ok: true, teacherSlug, teacherIsPublic };
}

// Review and teacher-suggestion moderation (plan.md §7). Used by admins and moderators.
//
// Every status change is conditional on the current status (WHERE status = …), so two
// moderators acting on the same item can't both succeed; the second gets `conflict`.
// Cached scores are recalculated in the same batch as the change (see scoring.ts).

import { cleanComment, COMMENT_MAX, SUBJECT_MAX } from './reviews';
import { institutionAggregateStatements, teacherAggregateStatements } from './scoring';
import { normalizeForSearch, slugify } from './slug';
import { uniqueSlugs, type TeacherStatus } from './teachers';
import { cleanLine, NAME_MAX, teacherNameError } from './validate';

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'removed';

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: 'Gaida pārbaudi',
  approved: 'Publicēta',
  rejected: 'Noraidīta',
  removed: 'Noņemta',
};

export const REJECT_REASONS = [
  'Aizskaroši izteicieni vai draudi',
  'Personas dati vai kontaktinformācija',
  'Apgalvojumi par privāto dzīvi, izskatu vai veselību',
  'Nepārbaudāmas apsūdzības',
  'Nav saistīts ar mācībām vai surogātpasts',
  'Atkārtota vai, visticamāk, viltota atsauksme',
];

export type ActionResult = { ok: true } | { ok: false; error: string };

const CONFLICT: ActionResult = { ok: false, error: 'Šo ierakstu jau apstrādāja kāds cits. Lapa ir atjaunota.' };

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface ModerationReview {
  id: number;
  status: ReviewStatus;
  overall_score: number;
  subject: string | null;
  period: string | null;
  comment: string;
  comment_original: string | null;
  edited_by_moderator: number;
  rejection_reason: string | null;
  created_at: string;
  moderated_at: string | null;
  moderator_email: string | null;
  teacher_id: number;
  teacher_name: string;
  teacher_slug: string;
  teacher_status: TeacherStatus;
  teacher_source: string;
  teacher_review_count: number;
  institution_id: number;
  institution_name: string;
  institution_slug: string;
}

export async function getReviewForModeration(db: D1Database, id: number) {
  const [review, scores, tags, otherPending, sameInstitutionTeachers] = await db.batch([
    db
      .prepare(
        `SELECT r.id, r.status, r.overall_score, r.subject, r.period, r.comment, r.comment_original,
                r.edited_by_moderator, r.rejection_reason, r.created_at, r.moderated_at,
                a.email AS moderator_email,
                t.id AS teacher_id, t.full_name AS teacher_name, t.slug AS teacher_slug, t.status AS teacher_status,
                t.source AS teacher_source, t.review_count AS teacher_review_count,
                i.id AS institution_id, i.name AS institution_name, i.slug AS institution_slug
           FROM reviews r
           JOIN teachers t     ON t.id = r.teacher_id
           JOIN institutions i ON i.id = r.institution_id
           LEFT JOIN admin_users a ON a.id = r.moderated_by
          WHERE r.id = ?1`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT c.label, rs.score FROM review_scores rs JOIN criteria c ON c.id = rs.criterion_id
          WHERE rs.review_id = ?1 ORDER BY c.sort_order, c.id`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT t.label, t.sentiment FROM review_tags rt JOIN tags t ON t.id = rt.tag_id
          WHERE rt.review_id = ?1 ORDER BY t.sort_order, t.id`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM reviews
          WHERE teacher_id = (SELECT teacher_id FROM reviews WHERE id = ?1) AND status = 'pending' AND id <> ?1`,
      )
      .bind(id),
    // For "this suggestion is an existing teacher": active teachers at the same institution
    db
      .prepare(
        `SELECT t.id, t.full_name, t.name_search FROM teacher_institutions ti
           JOIN teachers t ON t.id = ti.teacher_id AND t.status = 'active'
          WHERE ti.institution_id = (SELECT institution_id FROM reviews WHERE id = ?1)
          ORDER BY t.name_search`,
      )
      .bind(id),
  ]);

  const r = review.results[0] as ModerationReview | undefined;
  if (!r) return null;

  // Put likely matches (sharing a word of 3+ letters with the suggested name) first.
  const words = normalizeForSearch(r.teacher_name).split(' ').filter((w) => w.length >= 3);
  const candidates = (sameInstitutionTeachers.results as { id: number; full_name: string; name_search: string }[])
    .map((t) => ({ id: t.id, full_name: t.full_name, likely: t.name_search.split(' ').some((w) => words.includes(w)) }))
    .sort((a, b) => Number(b.likely) - Number(a.likely));

  return {
    review: r,
    scores: scores.results as { label: string; score: number }[],
    tags: tags.results as { label: string; sentiment: string }[],
    otherPendingForTeacher: (otherPending.results[0] as { n: number }).n,
    existingTeachers: candidates,
  };
}

/** Oldest pending review, optionally the next one after a skipped review. */
export async function nextPendingReviewId(db: D1Database, after: number | null): Promise<number | null> {
  const row = after
    ? await db
        .prepare(
          `SELECT r.id FROM reviews r, (SELECT created_at, id FROM reviews WHERE id = ?1) s
            WHERE r.status = 'pending' AND (r.created_at > s.created_at OR (r.created_at = s.created_at AND r.id > s.id))
            ORDER BY r.created_at, r.id LIMIT 1`,
        )
        .bind(after)
        .first<{ id: number }>()
    : await db
        .prepare(`SELECT id FROM reviews WHERE status = 'pending' ORDER BY created_at, id LIMIT 1`)
        .first<{ id: number }>();
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Review actions
// ---------------------------------------------------------------------------

export interface TextEdit {
  comment: string;
  subject: string;
}

export function parseTextEdit(form: FormData): { edit: TextEdit; error: string | null } {
  const edit = { comment: cleanComment(form.get('comment')), subject: cleanLine(form.get('subject'), SUBJECT_MAX + 1) };
  if (!edit.comment) return { edit, error: 'Atsauksmes teksts nevar būt tukšs.' };
  if ([...edit.comment].length > COMMENT_MAX) return { edit, error: `Teksts nedrīkst būt garāks par ${COMMENT_MAX} rakstzīmēm.` };
  if (edit.subject.length > SUBJECT_MAX) return { edit, error: `Priekšmets nedrīkst būt garāks par ${SUBJECT_MAX} rakstzīmēm.` };
  return { edit, error: null };
}

/**
 * Statement that applies a moderator's text edit. The first edit keeps the student's original
 * comment in comment_original (visible only in the CMS) and marks the review as edited.
 * Does nothing when the text is unchanged.
 */
function textEditStatement(db: D1Database, id: number, edit: TextEdit, requiredStatus: ReviewStatus): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE reviews SET
         comment_original    = CASE WHEN comment <> ?2 THEN COALESCE(comment_original, comment) ELSE comment_original END,
         edited_by_moderator = CASE WHEN comment <> ?2 OR COALESCE(subject, '') <> ?3 THEN 1 ELSE edited_by_moderator END,
         comment             = ?2,
         subject             = NULLIF(?3, '')
       WHERE id = ?1 AND status = ?4`,
    )
    .bind(id, edit.comment, edit.subject, requiredStatus);
}

function scoreStatements(db: D1Database, r: { teacher_id: number; institution_id: number }) {
  return [...teacherAggregateStatements(db, [r.teacher_id]), ...institutionAggregateStatements(db, [r.institution_id])];
}

export async function approveReview(
  db: D1Database,
  r: ModerationReview,
  adminId: number,
  edit: TextEdit | null,
): Promise<ActionResult> {
  if (r.teacher_status !== 'active') {
    return { ok: false, error: 'Vispirms apstipriniet ieteikto pedagogu (vai piesaistiet atsauksmi esošam pedagogam).' };
  }
  const statements: D1PreparedStatement[] = [];
  // Both the edit and the status change only apply while the review is still pending.
  if (edit) statements.push(textEditStatement(db, r.id, edit, 'pending'));
  statements.push(
    db
      .prepare(
        `UPDATE reviews SET status = 'approved', rejection_reason = NULL, moderated_at = datetime('now'), moderated_by = ?2
          WHERE id = ?1 AND status = 'pending'`,
      )
      .bind(r.id, adminId),
    ...scoreStatements(db, r),
  );
  const results = await db.batch(statements);
  return results[edit ? 1 : 0].meta.changes ? { ok: true } : CONFLICT;
}

/** Text edit on an already published review (e.g. after a complaint). */
export async function editPublishedReview(db: D1Database, r: ModerationReview, edit: TextEdit): Promise<ActionResult> {
  const [result] = await db.batch([textEditStatement(db, r.id, edit, 'approved')]);
  return result.meta.changes ? { ok: true } : CONFLICT;
}

export function parseReason(form: FormData): { reason: string; error: string | null } {
  const preset = cleanLine(form.get('reason'), 200);
  const custom = cleanLine(form.get('reason_custom'), 300);
  const reason = preset === 'cits' ? custom : [preset, custom].filter(Boolean).join(': ');
  return { reason, error: reason ? null : 'Norādiet iemeslu.' };
}

export async function rejectReview(db: D1Database, r: ModerationReview, adminId: number, reason: string): Promise<ActionResult> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE reviews SET status = 'rejected', rejection_reason = ?3, moderated_at = datetime('now'), moderated_by = ?2
          WHERE id = ?1 AND status = 'pending'`,
      )
      .bind(r.id, adminId, reason),
  ]);
  if (!results[0].meta.changes) return CONFLICT;

  // A suggested teacher exists only through their reviews. If none are left waiting, the
  // suggestion itself is dropped, so the CMS isn't left with teachers nobody will approve.
  if (r.teacher_status === 'pending') {
    const left = await db
      .prepare(`SELECT COUNT(*) AS n FROM reviews WHERE teacher_id = ?1 AND status = 'pending'`)
      .bind(r.teacher_id)
      .first<{ n: number }>();
    if (!left?.n) await deleteSuggestedTeacher(db, r.teacher_id);
  }
  return { ok: true };
}

/** Takes a published review down (status 'removed'); it stops counting towards scores. */
export async function removeReview(db: D1Database, r: ModerationReview, adminId: number, reason: string): Promise<ActionResult> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE reviews SET status = 'removed', rejection_reason = ?3, moderated_at = datetime('now'), moderated_by = ?2
          WHERE id = ?1 AND status = 'approved'`,
      )
      .bind(r.id, adminId, reason),
    ...scoreStatements(db, r),
  ]);
  return results[0].meta.changes ? { ok: true } : CONFLICT;
}

/** Undo for rejected/removed reviews: puts them back in the queue. */
export async function requeueReview(db: D1Database, r: ModerationReview): Promise<ActionResult> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE reviews SET status = 'pending', rejection_reason = NULL, moderated_at = NULL, moderated_by = NULL
          WHERE id = ?1 AND status IN ('rejected', 'removed')`,
      )
      .bind(r.id),
    ...scoreStatements(db, r),
  ]);
  return results[0].meta.changes ? { ok: true } : CONFLICT;
}

// ---------------------------------------------------------------------------
// Suggested teachers
// ---------------------------------------------------------------------------

/**
 * Publishes a suggested teacher, optionally with a corrected name. The page address is
 * regenerated from the corrected name: the teacher was never public, so no links break.
 */
export async function approveSuggestedTeacher(
  db: D1Database,
  r: ModerationReview,
  rawName: unknown,
): Promise<ActionResult> {
  const name = cleanLine(rawName, NAME_MAX + 1);
  const nameError = teacherNameError(name);
  if (nameError) return { ok: false, error: nameError };

  const duplicate = await db
    .prepare(
      `SELECT t.full_name FROM teachers t JOIN teacher_institutions ti ON ti.teacher_id = t.id AND ti.institution_id = ?2
        WHERE t.name_search = ?1 AND t.id <> ?3 AND t.status = 'active' LIMIT 1`,
    )
    .bind(normalizeForSearch(name), r.institution_id, r.teacher_id)
    .first<{ full_name: string }>();
  if (duplicate) {
    return { ok: false, error: `Šajā iestādē jau ir pedagogs “${duplicate.full_name}”. Piesaistiet atsauksmi esošajam pedagogam.` };
  }

  const slug = slugify(name) === slugify(r.teacher_name) ? r.teacher_slug : (await uniqueSlugs(db, [name]))[0];
  const results = await db.batch([
    db
      .prepare(`UPDATE teachers SET status = 'active', full_name = ?2, name_search = ?3, slug = ?4 WHERE id = ?1 AND status = 'pending'`)
      .bind(r.teacher_id, name, normalizeForSearch(name), slug),
  ]);
  return results[0].meta.changes ? { ok: true } : CONFLICT;
}

/**
 * The suggestion is a teacher who already exists: move all of its reviews to that teacher,
 * make sure that teacher is linked to the institution, and delete the suggestion.
 */
export async function assignSuggestionToTeacher(db: D1Database, r: ModerationReview, targetId: number): Promise<ActionResult> {
  const target = await db
    .prepare(`SELECT id FROM teachers WHERE id = ?1 AND status = 'active'`)
    .bind(targetId)
    .first<{ id: number }>();
  if (!target) return { ok: false, error: 'Izvēlētais pedagogs nav atrasts.' };

  const check = await db.prepare(`SELECT status FROM teachers WHERE id = ?1`).bind(r.teacher_id).first<{ status: string }>();
  if (check?.status !== 'pending') return CONFLICT;

  await db.batch([
    db
      .prepare(
        `INSERT INTO teacher_institutions (teacher_id, institution_id, subjects)
         SELECT ?2, institution_id, subjects FROM teacher_institutions WHERE teacher_id = ?1
         ON CONFLICT(teacher_id, institution_id) DO NOTHING`,
      )
      .bind(r.teacher_id, targetId),
    db.prepare(`UPDATE reviews SET teacher_id = ?2 WHERE teacher_id = ?1`).bind(r.teacher_id, targetId),
    db.prepare(`DELETE FROM teacher_institutions WHERE teacher_id = ?1`).bind(r.teacher_id),
    db.prepare(`DELETE FROM teachers WHERE id = ?1 AND status = 'pending'`).bind(r.teacher_id),
    // Only pending reviews were moved, so the target's published score is unchanged; recalculated anyway for safety.
    ...teacherAggregateStatements(db, [targetId]),
  ]);
  return { ok: true };
}

/** Rejects a suggestion: deletes the suggested teacher and every review written about them. */
export async function rejectSuggestedTeacher(db: D1Database, r: ModerationReview): Promise<ActionResult> {
  const check = await db.prepare(`SELECT status FROM teachers WHERE id = ?1`).bind(r.teacher_id).first<{ status: string }>();
  if (check?.status !== 'pending') return CONFLICT;
  await deleteSuggestedTeacher(db, r.teacher_id);
  return { ok: true };
}

/** Deletes a suggested teacher that has no reviews at all (nothing to moderate). */
export async function deleteEmptySuggestion(db: D1Database, teacherId: number): Promise<ActionResult> {
  const row = await db
    .prepare(`SELECT status, (SELECT COUNT(*) FROM reviews WHERE teacher_id = ?1) AS reviews FROM teachers WHERE id = ?1`)
    .bind(teacherId)
    .first<{ status: string; reviews: number }>();
  if (row?.status !== 'pending' || row.reviews > 0) return CONFLICT;
  await deleteSuggestedTeacher(db, teacherId);
  return { ok: true };
}

async function deleteSuggestedTeacher(db: D1Database, teacherId: number) {
  const reviewIds = `SELECT id FROM reviews WHERE teacher_id = ?1`;
  await db.batch([
    db.prepare(`DELETE FROM review_tags     WHERE review_id IN (${reviewIds})`).bind(teacherId),
    db.prepare(`DELETE FROM review_scores   WHERE review_id IN (${reviewIds})`).bind(teacherId),
    db.prepare(`DELETE FROM teacher_replies WHERE review_id IN (${reviewIds})`).bind(teacherId),
    db.prepare(`DELETE FROM reviews WHERE teacher_id = ?1`).bind(teacherId),
    db.prepare(`DELETE FROM teacher_institutions WHERE teacher_id = ?1`).bind(teacherId),
    db.prepare(`DELETE FROM teachers WHERE id = ?1 AND status = 'pending'`).bind(teacherId),
  ]);
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export const LIST_PAGE_SIZE = 30;

export interface ReviewListRow {
  id: number;
  status: ReviewStatus;
  overall_score: number;
  comment: string;
  edited_by_moderator: number;
  created_at: string;
  teacher_name: string;
  teacher_status: TeacherStatus;
  institution_name: string;
}

export async function listReviews(db: D1Database, filters: { status: ReviewStatus; q: string; page: number }) {
  const q = normalizeForSearch(filters.q);
  const where = `r.status = ?1 AND (?2 = '' OR t.name_search LIKE '%' || ?2 || '%' OR i.name_search LIKE '%' || ?2 || '%')`;
  const [count, rows] = await db.batch([
    db
      .prepare(`SELECT COUNT(*) AS n FROM reviews r JOIN teachers t ON t.id = r.teacher_id JOIN institutions i ON i.id = r.institution_id WHERE ${where}`)
      .bind(filters.status, q),
    db
      .prepare(
        `SELECT r.id, r.status, r.overall_score, r.comment, r.edited_by_moderator, r.created_at,
                t.full_name AS teacher_name, t.status AS teacher_status, i.name AS institution_name
           FROM reviews r JOIN teachers t ON t.id = r.teacher_id JOIN institutions i ON i.id = r.institution_id
          WHERE ${where}
          ORDER BY ${filters.status === 'pending' ? 'r.created_at ASC' : 'COALESCE(r.moderated_at, r.created_at) DESC'}, r.id
          LIMIT ?3 OFFSET ?4`,
      )
      .bind(filters.status, q, LIST_PAGE_SIZE, (filters.page - 1) * LIST_PAGE_SIZE),
  ]);
  const total = (count.results[0] as { n: number }).n;
  return { rows: rows.results as unknown as ReviewListRow[], total, totalPages: Math.max(1, Math.ceil(total / LIST_PAGE_SIZE)) };
}

export async function reviewStatusCounts(db: D1Database): Promise<Record<ReviewStatus, number>> {
  const { results } = await db.prepare(`SELECT status, COUNT(*) AS n FROM reviews GROUP BY status`).all<{ status: ReviewStatus; n: number }>();
  const counts: Record<ReviewStatus, number> = { pending: 0, approved: 0, rejected: 0, removed: 0 };
  for (const r of results) counts[r.status] = r.n;
  return counts;
}

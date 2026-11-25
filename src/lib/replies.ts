// Teacher replies (plan.md §7). A teacher submits a reply with a contact email; a moderator
// checks the sender really is the teacher, then approves or rejects. The email is deleted on
// either decision (data minimisation).

import { cleanComment } from './reviews';
import { cleanLine } from './validate';

export const REPLY_MIN = 20;
export const REPLY_MAX = 1500;
export const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface ReplyTarget {
  id: number;
  comment: string;
  overall_score: number;
  subject: string | null;
  period: string | null;
  created_at: string;
  teacher_name: string;
  teacher_slug: string;
  institution_name: string;
}

/** Only approved reviews of active teachers can be answered. */
export async function getReplyTarget(db: D1Database, reviewId: number): Promise<ReplyTarget | null> {
  return db
    .prepare(
      `SELECT r.id, r.comment, r.overall_score, r.subject, r.period, r.created_at,
              t.full_name AS teacher_name, t.slug AS teacher_slug, i.name AS institution_name
         FROM reviews r
         JOIN teachers t     ON t.id = r.teacher_id AND t.status = 'active'
         JOIN institutions i ON i.id = r.institution_id AND i.hidden = 0
        WHERE r.id = ?1 AND r.status = 'approved'`,
    )
    .bind(reviewId)
    .first<ReplyTarget>();
}

export interface ReplyValues {
  body: string;
  email: string;
  confirmed: boolean;
}

export function parseReplyForm(form: FormData): { values: ReplyValues; errors: Record<string, string> } {
  const values: ReplyValues = {
    body: cleanComment(form.get('body')),
    email: cleanLine(form.get('email'), 255).toLowerCase(),
    confirmed: form.get('confirm') === 'on',
  };
  const errors: Record<string, string> = {};
  const length = [...values.body].length;
  if (length < REPLY_MIN) errors.body = `Atbildei jābūt vismaz ${REPLY_MIN} rakstzīmes garai (tagad ${length}).`;
  else if (length > REPLY_MAX) errors.body = `Atbilde nedrīkst būt garāka par ${REPLY_MAX} rakstzīmēm (tagad ${length}).`;
  if (!EMAIL_RE.test(values.email) || values.email.length > 254) errors.email = 'Norādiet derīgu e-pasta adresi.';
  if (!values.confirmed) errors.confirm = 'Apstipriniet, ka esat šis pedagogs.';
  return { values, errors };
}

export async function submitReply(db: D1Database, reviewId: number, values: ReplyValues): Promise<void> {
  await db
    .prepare(`INSERT INTO teacher_replies (review_id, body, contact_email, status) VALUES (?1, ?2, ?3, 'pending')`)
    .bind(reviewId, values.body, values.email)
    .run();
}

// ---------------------------------------------------------------------------
// CMS
// ---------------------------------------------------------------------------

export interface PendingReply {
  id: number;
  body: string;
  contact_email: string | null;
  created_at: string;
  review_id: number;
  review_comment: string;
  review_score: number;
  teacher_name: string;
  teacher_slug: string;
  institution_name: string;
  has_approved_reply: number;
}

export async function listPendingReplies(db: D1Database): Promise<PendingReply[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.body, p.contact_email, p.created_at,
              r.id AS review_id, r.comment AS review_comment, r.overall_score AS review_score,
              t.full_name AS teacher_name, t.slug AS teacher_slug, i.name AS institution_name,
              EXISTS (SELECT 1 FROM teacher_replies x WHERE x.review_id = r.id AND x.status = 'approved') AS has_approved_reply
         FROM teacher_replies p
         JOIN reviews r      ON r.id = p.review_id
         JOIN teachers t     ON t.id = r.teacher_id
         JOIN institutions i ON i.id = r.institution_id
        WHERE p.status = 'pending'
        ORDER BY p.created_at, p.id`,
    )
    .all<PendingReply>();
  return results;
}

/**
 * Publishes a reply (the moderator may have edited the text). A review shows one reply, so
 * an earlier approved reply to the same review is replaced. The contact email is deleted.
 */
export async function approveReply(db: D1Database, replyId: number, adminId: number, rawBody: unknown): Promise<ActionResult> {
  const body = cleanComment(rawBody);
  if (!body) return { ok: false, error: 'Atbildes teksts nevar būt tukšs.' };
  if ([...body].length > REPLY_MAX) return { ok: false, error: `Atbilde nedrīkst būt garāka par ${REPLY_MAX} rakstzīmēm.` };

  const results = await db.batch([
    db
      .prepare(
        `UPDATE teacher_replies SET status = 'rejected', contact_email = NULL
          WHERE status = 'approved' AND id <> ?1
            AND review_id = (SELECT review_id FROM teacher_replies WHERE id = ?1 AND status = 'pending')`,
      )
      .bind(replyId),
    db
      .prepare(
        `UPDATE teacher_replies SET status = 'approved', body = ?3, contact_email = NULL,
                moderated_at = datetime('now'), moderated_by = ?2
          WHERE id = ?1 AND status = 'pending'`,
      )
      .bind(replyId, adminId, body),
  ]);
  return results[1].meta.changes ? { ok: true } : { ok: false, error: 'Šo atbildi jau apstrādāja kāds cits.' };
}

export async function rejectReply(db: D1Database, replyId: number, adminId: number): Promise<ActionResult> {
  const result = await db
    .prepare(
      `UPDATE teacher_replies SET status = 'rejected', contact_email = NULL, moderated_at = datetime('now'), moderated_by = ?2
        WHERE id = ?1 AND status = 'pending'`,
    )
    .bind(replyId, adminId)
    .run();
  return result.meta.changes ? { ok: true } : { ok: false, error: 'Šo atbildi jau apstrādāja kāds cits.' };
}

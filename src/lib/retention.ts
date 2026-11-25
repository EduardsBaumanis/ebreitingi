// Data retention (plan.md §9), run daily by the Cron Trigger in src/worker.ts.
// Keep these periods in sync with /privatuma-politika.

export const RETENTION = {
  /** Removal requests (name, email, message): months after the request was resolved. */
  removalRequestMonths: 12,
  /** Rejected or taken-down reviews (and their scores, tags, replies): months after the decision. */
  rejectedReviewMonths: 12,
  /** Student's original text of a moderator-edited review (may contain the removed personal data): days after the edit. */
  originalTextDays: 90,
  /** Replies nobody approved or rejected: their contact email is dropped after this many days. */
  pendingReplyEmailDays: 90,
} as const;

/** Statements that delete or anonymise data past its retention period. Safe to run repeatedly. */
export function retentionStatements(db: D1Database): D1PreparedStatement[] {
  const oldRejected = `SELECT id FROM reviews
                        WHERE status IN ('rejected', 'removed')
                          AND moderated_at < datetime('now', '-${RETENTION.rejectedReviewMonths} months')`;
  return [
    db.prepare(
      `DELETE FROM removal_requests
        WHERE status <> 'open' AND resolved_at < datetime('now', '-${RETENTION.removalRequestMonths} months')`,
    ),
    db.prepare(`DELETE FROM review_tags     WHERE review_id IN (${oldRejected})`),
    db.prepare(`DELETE FROM review_scores   WHERE review_id IN (${oldRejected})`),
    db.prepare(`DELETE FROM teacher_replies WHERE review_id IN (${oldRejected})`),
    db.prepare(`DELETE FROM reviews         WHERE id IN (${oldRejected})`),
    // moderated_at is when the review was approved; an approved review is edited at approval or later.
    db.prepare(
      `UPDATE reviews SET comment_original = NULL
        WHERE comment_original IS NOT NULL
          AND COALESCE(moderated_at, created_at) < datetime('now', '-${RETENTION.originalTextDays} days')`,
    ),
    db.prepare(
      `UPDATE teacher_replies SET contact_email = NULL
        WHERE contact_email IS NOT NULL AND created_at < datetime('now', '-${RETENTION.pendingReplyEmailDays} days')`,
    ),
  ];
}

export async function runRetention(db: D1Database): Promise<Record<string, number>> {
  const results = await db.batch(retentionStatements(db));
  const names = ['removal_requests', 'review_tags', 'review_scores', 'teacher_replies', 'reviews', 'original_texts', 'reply_emails'];
  return Object.fromEntries(results.map((r, i) => [names[i], r.meta.changes ?? 0]));
}

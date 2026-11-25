// Cached aggregate recalculation (plan.md §8).
//
// These return prepared statements instead of running them, so callers can put them in the
// same db.batch() as the change that caused them (status change, approval, …). A batch runs
// as one transaction, so the cached numbers never disagree with the reviews.
//
// Rules:
//  - Only approved reviews count.
//  - Teacher score: mean of overall_score over the teacher's approved reviews.
//  - Institution score: mean of per-teacher averages, using only reviews given for that
//    institution and only active teachers (each teacher counts equally).

/** Recalculate teachers.avg_score / review_count for the given teacher ids. */
export function teacherAggregateStatements(db: D1Database, teacherIds: number[]): D1PreparedStatement[] {
  if (!teacherIds.length) return [];
  return [
    db
      .prepare(
        `UPDATE teachers SET
           review_count = (SELECT COUNT(*) FROM reviews WHERE teacher_id = teachers.id AND status = 'approved'),
           avg_score    = (SELECT AVG(overall_score) FROM reviews WHERE teacher_id = teachers.id AND status = 'approved')
         WHERE id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(JSON.stringify(teacherIds)),
  ];
}

const INSTITUTION_UPDATE = `
  UPDATE institutions SET
    avg_score = (
      SELECT AVG(x.teacher_avg) FROM (
        SELECT AVG(r.overall_score) AS teacher_avg
          FROM reviews r JOIN teachers t ON t.id = r.teacher_id AND t.status = 'active'
         WHERE r.institution_id = institutions.id AND r.status = 'approved'
         GROUP BY r.teacher_id
      ) x),
    rated_teachers = (
      SELECT COUNT(DISTINCT r.teacher_id)
        FROM reviews r JOIN teachers t ON t.id = r.teacher_id AND t.status = 'active'
       WHERE r.institution_id = institutions.id AND r.status = 'approved'),
    review_count = (
      SELECT COUNT(*)
        FROM reviews r JOIN teachers t ON t.id = r.teacher_id AND t.status = 'active'
       WHERE r.institution_id = institutions.id AND r.status = 'approved'),
    updated_at = datetime('now')`;

/** Recalculate the cached scores of the given institutions. */
export function institutionAggregateStatements(db: D1Database, institutionIds: number[]): D1PreparedStatement[] {
  if (!institutionIds.length) return [];
  return [
    db
      .prepare(`${INSTITUTION_UPDATE} WHERE id IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify(institutionIds)),
  ];
}

/**
 * Recalculate every institution where this teacher has reviews. Used when a teacher's
 * status changes, because hidden/removed teachers drop out of institution scores.
 * Evaluated inside the batch, so it sees the new status.
 */
export function institutionsOfTeacherStatements(db: D1Database, teacherId: number): D1PreparedStatement[] {
  return [
    db
      .prepare(`${INSTITUTION_UPDATE} WHERE id IN (SELECT DISTINCT institution_id FROM reviews WHERE teacher_id = ?1)`)
      .bind(teacherId),
  ];
}

/** Rebuild all cached aggregates ("Pārrēķināt visu"). */
export function allAggregateStatements(db: D1Database): D1PreparedStatement[] {
  return [
    db.prepare(
      `UPDATE teachers SET
         review_count = (SELECT COUNT(*) FROM reviews WHERE teacher_id = teachers.id AND status = 'approved'),
         avg_score    = (SELECT AVG(overall_score) FROM reviews WHERE teacher_id = teachers.id AND status = 'approved')`,
    ),
    db.prepare(INSTITUTION_UPDATE),
  ];
}

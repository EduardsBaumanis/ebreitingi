import { beforeEach, describe, expect, it } from 'vitest';
import { mergeTeachers } from '../src/lib/admin-teachers';
import {
  approveReview,
  approveSuggestedTeacher,
  assignSuggestionToTeacher,
  getReviewForModeration,
  rejectReview,
  rejectSuggestedTeacher,
  removeReview,
  requeueReview,
} from '../src/lib/moderation';
import { removeTeacherForRequest } from '../src/lib/removal';
import { submitReview, type ReviewValues } from '../src/lib/reviews';
import { allAggregateStatements } from '../src/lib/scoring';
import { createTeachers } from '../src/lib/teachers';
import { addAdmin, addInstitution, createTestDb, type TestD1 } from './d1';

let db: TestD1;
let adminId: number;
let school: number;
let university: number;

/** A review where every criterion gets the same score (so overall = score). */
function values(score: number, comment = 'Pietiekami gara atsauksme testam, vairāk nekā trīsdesmit zīmes.'): ReviewValues {
  const criteria = db.all<{ id: number }>(`SELECT id FROM criteria WHERE active = 1`);
  return {
    scores: Object.fromEntries(criteria.map((c) => [c.id, score])),
    tagIds: [1],
    subject: 'Matemātika',
    period: '2025/2026',
    comment,
    acceptedRules: true,
  };
}

async function teacher(name: string, institutionId: number): Promise<number> {
  const [slug] = await createTeachers(db.d1, [{ fullName: name, institutionId, subjects: null }], { status: 'active', source: 'admin' });
  return db.get<{ id: number }>(`SELECT id FROM teachers WHERE slug = ?`, slug).id;
}

async function review(teacherId: number, institutionId: number, score: number): Promise<number> {
  const result = await submitReview(db.d1, { kind: 'existing', teacherId, institutionId }, values(score));
  expect(result.ok).toBe(true);
  return db.get<{ id: number }>(`SELECT MAX(id) AS id FROM reviews`).id;
}

async function moderation(reviewId: number) {
  const data = await getReviewForModeration(db.d1, reviewId);
  if (!data) throw new Error(`review ${reviewId} not found`);
  return data.review;
}

async function approve(reviewId: number) {
  expect(await approveReview(db.d1, await moderation(reviewId), adminId, null)).toEqual({ ok: true });
}

const teacherScore = (id: number) => db.get<{ avg_score: number | null; review_count: number }>(`SELECT avg_score, review_count FROM teachers WHERE id = ?`, id);
const institutionScore = (id: number) =>
  db.get<{ avg_score: number | null; rated_teachers: number; review_count: number }>(
    `SELECT avg_score, rated_teachers, review_count FROM institutions WHERE id = ?`,
    id,
  );

/** Cached numbers must always equal a fresh calculation from the reviews. */
async function expectCacheConsistent() {
  const before = db.all(`SELECT id, avg_score, rated_teachers, review_count FROM institutions ORDER BY id`);
  const beforeTeachers = db.all(`SELECT id, avg_score, review_count FROM teachers ORDER BY id`);
  await db.batch(allAggregateStatements(db.d1) as never);
  expect(db.all(`SELECT id, avg_score, rated_teachers, review_count FROM institutions ORDER BY id`)).toEqual(before);
  expect(db.all(`SELECT id, avg_score, review_count FROM teachers ORDER BY id`)).toEqual(beforeTeachers);
}

beforeEach(() => {
  db = createTestDb();
  adminId = addAdmin(db);
  school = addInstitution(db, 'Testa vidusskola', '1000000001');
  university = addInstitution(db, 'Testa universitāte', '1000000002');
});

describe('submitting reviews', () => {
  it('saves a pending review with all scores and tags in one go, without touching scores', async () => {
    const anna = await teacher('Anna Bērziņa', school);
    const id = await review(anna, school, 4);
    expect(db.get(`SELECT status, overall_score, subject, period FROM reviews WHERE id = ?`, id)).toEqual({
      status: 'pending',
      overall_score: 4,
      subject: 'Matemātika',
      period: '2025/2026',
    });
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM review_scores WHERE review_id = ?`, id).n).toBe(5);
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM review_tags WHERE review_id = ?`, id).n).toBe(1);
    expect(teacherScore(anna)).toEqual({ avg_score: null, review_count: 0 });
  });

  it('computes overall score as the mean of criterion scores', async () => {
    const anna = await teacher('Anna Bērziņa', school);
    const v = values(5);
    const ids = Object.keys(v.scores).map(Number);
    v.scores = { [ids[0]]: 1, [ids[1]]: 2, [ids[2]]: 3, [ids[3]]: 4, [ids[4]]: 5 };
    await submitReview(db.d1, { kind: 'existing', teacherId: anna, institutionId: school }, v);
    expect(db.get<{ s: number }>(`SELECT overall_score AS s FROM reviews`).s).toBe(3);
  });

  it('refuses reviews for an institution the teacher is not linked to', async () => {
    const anna = await teacher('Anna Bērziņa', school);
    const result = await submitReview(db.d1, { kind: 'existing', teacherId: anna, institutionId: university }, values(4));
    expect(result.ok).toBe(false);
  });

  it('attaches a suggested name to an existing teacher instead of duplicating', async () => {
    const anna = await teacher('Anna Bērziņa', school);
    const result = await submitReview(db.d1, { kind: 'suggested', fullName: 'ANNA berzina', institutionId: school }, values(4));
    expect(result).toMatchObject({ ok: true, teacherIsPublic: true });
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM teachers`).n).toBe(1);
    expect(db.get<{ t: number }>(`SELECT teacher_id AS t FROM reviews`).t).toBe(anna);
  });

  it('creates one pending teacher for repeated suggestions of the same new name', async () => {
    await submitReview(db.d1, { kind: 'suggested', fullName: 'Ilze Kalna', institutionId: school }, values(4));
    await submitReview(db.d1, { kind: 'suggested', fullName: 'ilze kalna', institutionId: school }, values(2));
    expect(db.all(`SELECT full_name, status, source FROM teachers`)).toEqual([{ full_name: 'Ilze Kalna', status: 'pending', source: 'suggested' }]);
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM reviews`).n).toBe(2);
  });

  it('refuses suggestions matching a removed or hidden teacher', async () => {
    const anna = await teacher('Anna Bērziņa', school);
    db.run(`UPDATE teachers SET status = 'removed' WHERE id = ?`, anna);
    const result = await submitReview(db.d1, { kind: 'suggested', fullName: 'Anna Bērziņa', institutionId: school }, values(4));
    expect(result.ok).toBe(false);
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM reviews`).n).toBe(0);
  });
});

describe('scores after moderation', () => {
  it('counts only approved reviews and weights teachers equally at an institution', async () => {
    const anna = await teacher('Anna Bērziņa', school);
    const janis = await teacher('Jānis Kalniņš', school);
    await approve(await review(anna, school, 5));
    await approve(await review(anna, school, 3));
    await approve(await review(janis, school, 2));
    await review(janis, school, 5); // pending: must not count

    expect(teacherScore(anna)).toEqual({ avg_score: 4, review_count: 2 });
    expect(teacherScore(janis)).toEqual({ avg_score: 2, review_count: 1 });
    // (4 + 2) / 2, not (5 + 3 + 2) / 3
    expect(institutionScore(school)).toEqual({ avg_score: 3, rated_teachers: 2, review_count: 3 });
    await expectCacheConsistent();
  });

  it('scores a teacher at each institution only from reviews given there', async () => {
    const anna = await teacher('Anna Bērziņa', school);
    db.run(`INSERT INTO teacher_institutions (teacher_id, institution_id) VALUES (?, ?)`, anna, university);
    await approve(await review(anna, school, 5));
    await approve(await review(anna, university, 1));
    expect(teacherScore(anna)).toEqual({ avg_score: 3, review_count: 2 });
    expect(institutionScore(school).avg_score).toBe(5);
    expect(institutionScore(university).avg_score).toBe(1);
    await expectCacheConsistent();
  });

  it('updates scores when a review is taken down and restored', async () => {
    const anna = await teacher('Anna Bērziņa', school);
    const a = await review(anna, school, 5);
    const b = await review(anna, school, 1);
    await approve(a);
    await approve(b);
    expect(teacherScore(anna).avg_score).toBe(3);

    expect(await removeReview(db.d1, await moderation(b), adminId, 'test')).toEqual({ ok: true });
    expect(teacherScore(anna)).toEqual({ avg_score: 5, review_count: 1 });
    expect(institutionScore(school).avg_score).toBe(5);

    expect(await requeueReview(db.d1, await moderation(b))).toEqual({ ok: true });
    expect(db.get<{ s: string }>(`SELECT status AS s FROM reviews WHERE id = ?`, b).s).toBe('pending');
    await expectCacheConsistent();
  });

  it('drops a removed teacher from institution scores', async () => {
    const anna = await teacher('Anna Bērziņa', school);
    const janis = await teacher('Jānis Kalniņš', school);
    await approve(await review(anna, school, 5));
    await approve(await review(janis, school, 1));
    expect(institutionScore(school).avg_score).toBe(3);
    await removeTeacherForRequest(db.d1, janis);
    expect(institutionScore(school)).toEqual({ avg_score: 5, rated_teachers: 1, review_count: 1 });
    await expectCacheConsistent();
  });
});

describe('moderation rules', () => {
  it('reports a conflict when the same review is approved twice', async () => {
    const anna = await teacher('Anna Bērziņa', school);
    const id = await review(anna, school, 4);
    const stale = await moderation(id);
    await approveReview(db.d1, stale, adminId, null);
    expect((await approveReview(db.d1, stale, adminId, null)).ok).toBe(false);
  });

  it('keeps the original text on the first edit only and marks the review', async () => {
    const anna = await teacher('Anna Bērziņa', school);
    const id = await review(anna, school, 4, );
    db.run(`UPDATE reviews SET comment = 'Zvaniet 20000000, viņa ir jauka.' WHERE id = ?`, id);
    await approveReview(db.d1, await moderation(id), adminId, { comment: 'Viņa ir jauka.', subject: 'Matemātika' });
    expect(db.get(`SELECT comment, comment_original, edited_by_moderator FROM reviews WHERE id = ?`, id)).toEqual({
      comment: 'Viņa ir jauka.',
      comment_original: 'Zvaniet 20000000, viņa ir jauka.',
      edited_by_moderator: 1,
    });
  });

  it('does not publish a review while its teacher is only a suggestion', async () => {
    await submitReview(db.d1, { kind: 'suggested', fullName: 'Ilze Kalna', institutionId: school }, values(4));
    const id = db.get<{ id: number }>(`SELECT id FROM reviews`).id;
    expect((await approveReview(db.d1, await moderation(id), adminId, null)).ok).toBe(false);

    expect(await approveSuggestedTeacher(db.d1, await moderation(id), 'Ilze Kalniņa')).toEqual({ ok: true });
    expect(db.get(`SELECT full_name, slug, status FROM teachers`)).toEqual({ full_name: 'Ilze Kalniņa', slug: 'ilze-kalnina', status: 'active' });
    await approve(id);
    expect(institutionScore(school).avg_score).toBe(4);
  });

  it('moves a suggestion\'s reviews to an existing teacher and deletes the suggestion', async () => {
    const liga = await teacher('Līga Ozola', school);
    await submitReview(db.d1, { kind: 'suggested', fullName: 'L. Ozola', institutionId: school }, values(4));
    const id = db.get<{ id: number }>(`SELECT id FROM reviews`).id;
    expect(await assignSuggestionToTeacher(db.d1, await moderation(id), liga)).toEqual({ ok: true });
    expect(db.get<{ t: number }>(`SELECT teacher_id AS t FROM reviews WHERE id = ?`, id).t).toBe(liga);
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM teachers`).n).toBe(1);
  });

  it('deletes a rejected suggestion with all its reviews, and drops a suggestion whose last review is rejected', async () => {
    await submitReview(db.d1, { kind: 'suggested', fullName: 'Izdomāts Vārds', institutionId: school }, values(3));
    await submitReview(db.d1, { kind: 'suggested', fullName: 'Izdomāts Vārds', institutionId: school }, values(3));
    const first = db.get<{ id: number }>(`SELECT MIN(id) AS id FROM reviews`).id;
    expect(await rejectSuggestedTeacher(db.d1, await moderation(first))).toEqual({ ok: true });
    expect(db.get(`SELECT (SELECT COUNT(*) FROM teachers) AS t, (SELECT COUNT(*) FROM reviews) AS r, (SELECT COUNT(*) FROM review_scores) AS s`)).toEqual({ t: 0, r: 0, s: 0 });

    await submitReview(db.d1, { kind: 'suggested', fullName: 'Vēl Viens', institutionId: school }, values(3));
    const only = db.get<{ id: number }>(`SELECT id FROM reviews`).id;
    expect(await rejectReview(db.d1, await moderation(only), adminId, 'Cits')).toEqual({ ok: true });
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM teachers`).n).toBe(0);
  });
});

describe('merging teachers', () => {
  it('moves reviews and links, redirects the old address and recalculates scores', async () => {
    const keep = await teacher('Anna Bērziņa', school);
    const dup = await teacher('Anna Bērziņa', university);
    const dupSlug = db.get<{ slug: string }>(`SELECT slug FROM teachers WHERE id = ?`, dup).slug;
    await approve(await review(keep, school, 5));
    await approve(await review(dup, university, 3));

    expect(await mergeTeachers(db.d1, dup, keep)).toEqual({ ok: true });
    expect(teacherScore(keep)).toEqual({ avg_score: 4, review_count: 2 });
    expect(db.all(`SELECT institution_id FROM teacher_institutions WHERE teacher_id = ? ORDER BY institution_id`, keep)).toEqual([
      { institution_id: school },
      { institution_id: university },
    ]);
    expect(db.get(`SELECT teacher_id FROM teacher_slug_redirects WHERE slug = ?`, dupSlug)).toEqual({ teacher_id: keep });
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM teachers WHERE id = ?`, dup).n).toBe(0);
    await expectCacheConsistent();

    // A new teacher with the same name must not reuse the redirected address
    const [slug] = await createTeachers(db.d1, [{ fullName: 'Anna Bērziņa', institutionId: school, subjects: null }], { status: 'active', source: 'admin' });
    expect(slug).not.toBe(dupSlug);
  });

  it('refuses to merge removed teachers', async () => {
    const a = await teacher('Anna Bērziņa', school);
    const b = await teacher('Anna Bērziņa', university);
    db.run(`UPDATE teachers SET status = 'removed' WHERE id = ?`, b);
    expect((await mergeTeachers(db.d1, a, b)).ok).toBe(false);
    expect((await mergeTeachers(db.d1, b, a)).ok).toBe(false);
    expect((await mergeTeachers(db.d1, a, a)).ok).toBe(false);
  });
});

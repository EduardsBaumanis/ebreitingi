// Bulk import, removal request targets and data retention.
import { describe, expect, it } from 'vitest';
import { resolveTarget } from '../src/lib/removal';
import { runRetention } from '../src/lib/retention';
import { analyzeImport, importableRows } from '../src/lib/teacher-import';
import { createTeachers } from '../src/lib/teachers';
import { addAdmin, addInstitution, createTestDb } from './d1';

describe('teacher import', () => {
  it('classifies every row and never re-creates removed teachers', async () => {
    const db = createTestDb();
    const school = addInstitution(db, 'Testa vidusskola', '1000000001');
    addInstitution(db, 'Testa universitāte', '1000000002');
    await createTeachers(db.d1, [{ fullName: 'Esošs Pedagogs', institutionId: school, subjects: null }], { status: 'active', source: 'admin' });
    await createTeachers(db.d1, [{ fullName: 'Dzēsts Pedagogs', institutionId: school, subjects: null }], { status: 'active', source: 'admin' });
    db.run(`UPDATE teachers SET status = 'removed' WHERE full_name = 'Dzēsts Pedagogs'`);

    const csv = [
      'full_name;institution_reg_number;subjects',
      'Jauns Pedagogs;1000000001;Fizika',
      'Jauns Pedagogs;1000000001;Fizika', // duplicate row
      'Esošs Pedagogs;1000000001;', // already there
      'esošs pedagogs;1000000002;', // same name elsewhere
      'Dzēsts Pedagogs;1000000001;', // removed after a request
      'X;1000000001;', // bad name
      'Nezināms Numurs;999999999;', // unknown institution
      'Tikai Vārds', // one column
    ].join('\n');

    const analysis = await analyzeImport(db.d1, csv);
    expect(analysis.fatal).toBeNull();
    expect(analysis.rows.map((r) => `${r.line}:${r.status}`)).toEqual([
      '2:ok',
      '3:skip',
      '4:skip',
      '5:warning',
      '6:skip',
      '7:error',
      '8:error',
      '9:error',
    ]);
    expect(analysis.rows[4].messages[0]).toMatch(/dzēsts pēc pieprasījuma/);
    expect(importableRows(analysis).map((r) => r.fullName)).toEqual(['Jauns Pedagogs', 'esošs pedagogs']);
  });

  it('rejects empty and oversized files', async () => {
    const db = createTestDb();
    expect((await analyzeImport(db.d1, '  ')).fatal).toMatch(/tukšs/);
    const big = Array.from({ length: 2001 }, (_, i) => `Vārds Nr${i};1000000001;`).join('\n');
    expect((await analyzeImport(db.d1, big)).fatal).toMatch(/2000/);
  });
});

describe('removal request targets', () => {
  it('finds teachers and reviews from links, but only public ones', async () => {
    const db = createTestDb();
    const school = addInstitution(db, 'Testa vidusskola', '1000000001');
    const [slug] = await createTeachers(db.d1, [{ fullName: 'Anna Bērziņa', institutionId: school, subjects: null }], { status: 'active', source: 'admin' });
    const teacherId = db.get<{ id: number }>(`SELECT id FROM teachers`).id;
    db.run(
      `INSERT INTO reviews (id, teacher_id, institution_id, comment, overall_score, status) VALUES (5, ?, ?, 'Teksts', 4, 'approved'), (6, ?, ?, 'Teksts', 4, 'pending')`,
      teacherId, school, teacherId, school,
    );

    expect(await resolveTarget(db.d1, { link: `https://vietne.lv/pedagogi/${slug}` })).toMatchObject({ type: 'teacher', id: teacherId });
    expect(await resolveTarget(db.d1, { link: `vietne.lv/pedagogi/${slug}#atsauksme-5` })).toMatchObject({ type: 'review', id: 5 });
    expect(await resolveTarget(db.d1, { reviewId: '6' })).toBeNull(); // pending: not public
    expect(await resolveTarget(db.d1, { link: 'https://google.com' })).toBeNull();
    db.run(`UPDATE teachers SET status = 'hidden'`);
    expect(await resolveTarget(db.d1, { teacherSlug: slug })).toBeNull();
  });
});

describe('data retention', () => {
  it('deletes and anonymises only data past its period', async () => {
    const db = createTestDb();
    const admin = addAdmin(db);
    const school = addInstitution(db, 'Testa vidusskola', '1000000001');
    await createTeachers(db.d1, [{ fullName: 'Anna Bērziņa', institutionId: school, subjects: null }], { status: 'active', source: 'admin' });
    const t = db.get<{ id: number }>(`SELECT id FROM teachers`).id;
    const old = "datetime('now', '-13 months')";
    const recent = "datetime('now', '-1 months')";

    db.sqlite.exec(`
      INSERT INTO reviews (id, teacher_id, institution_id, comment, overall_score, status, moderated_at) VALUES
        (1, ${t}, ${school}, 'old rejected', 2, 'rejected', ${old}),
        (2, ${t}, ${school}, 'recent rejected', 2, 'rejected', ${recent}),
        (3, ${t}, ${school}, 'old approved', 4, 'approved', ${old}),
        (4, ${t}, ${school}, 'old removed', 4, 'removed', ${old});
      UPDATE reviews SET comment_original = 'with phone 20000000' WHERE id IN (3);
      INSERT INTO review_scores (review_id, criterion_id, score) VALUES (1, 1, 2), (2, 1, 2), (3, 1, 4);
      INSERT INTO teacher_replies (review_id, body, contact_email, status, created_at) VALUES
        (3, 'pending old', 'a@b.lv', 'pending', ${old}),
        (3, 'pending new', 'c@d.lv', 'pending', datetime('now'));
      INSERT INTO removal_requests (requester_name, requester_email, relation, target_type, target_id, message, status, resolved_at, resolved_by) VALUES
        ('Old', 'o@x.lv', 'teacher', 'teacher', ${t}, 'm', 'granted', ${old}, ${admin}),
        ('Recent', 'r@x.lv', 'teacher', 'teacher', ${t}, 'm', 'denied', ${recent}, ${admin}),
        ('Open', 'p@x.lv', 'teacher', 'teacher', ${t}, 'm', 'open', NULL, NULL);
    `);

    await runRetention(db.d1);

    expect(db.all(`SELECT id FROM reviews ORDER BY id`)).toEqual([{ id: 2 }, { id: 3 }]);
    expect(db.all(`SELECT review_id FROM review_scores ORDER BY review_id`)).toEqual([{ review_id: 2 }, { review_id: 3 }]);
    expect(db.get(`SELECT comment, comment_original FROM reviews WHERE id = 3`)).toEqual({ comment: 'old approved', comment_original: null });
    expect(db.all(`SELECT body, contact_email FROM teacher_replies ORDER BY id`)).toEqual([
      { body: 'pending old', contact_email: null },
      { body: 'pending new', contact_email: 'c@d.lv' },
    ]);
    expect(db.all(`SELECT requester_name FROM removal_requests ORDER BY id`)).toEqual([{ requester_name: 'Recent' }, { requester_name: 'Open' }]);

    // Running again changes nothing
    const second = await runRetention(db.d1);
    expect(Object.values(second).every((n) => n === 0)).toBe(true);
  });
});

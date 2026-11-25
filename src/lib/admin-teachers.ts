// CMS-side teacher queries and actions (admin role only; pages check the role).
import { likeClause, likeTerms } from './search';
import { normalizeForSearch } from './slug';
import { createTeachers, resolveInstitution, type InstitutionChoice, type TeacherStatus } from './teachers';
import { institutionsOfTeacherStatements, teacherAggregateStatements } from './scoring';
import { cleanLine, NAME_MAX, positiveInt, SUBJECTS_MAX, teacherNameError } from './validate';

export const ADMIN_PAGE_SIZE = 50;
export const EDITABLE_STATUSES: TeacherStatus[] = ['active', 'hidden', 'removed', 'pending'];

export interface AdminTeacherRow {
  id: number;
  full_name: string;
  slug: string;
  status: TeacherStatus;
  source: string;
  review_count: number;
  pending_reviews: number;
  institutions: string | null;
  created_at: string;
}

export async function listTeachersAdmin(
  db: D1Database,
  filters: { q: string; status: TeacherStatus | null; page: number },
): Promise<{ rows: AdminTeacherRow[]; total: number; totalPages: number }> {
  const where: string[] = ['1 = 1'];
  const binds: (string | number)[] = [];
  const terms = likeTerms(filters.q);
  if (terms.length) {
    const clause = likeClause('t.name_search', terms);
    where.push(clause.sql);
    binds.push(...clause.binds);
  }
  if (filters.status) {
    where.push('t.status = ?');
    binds.push(filters.status);
  }
  const whereSql = where.join(' AND ');

  const [count, rows] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS total FROM teachers t WHERE ${whereSql}`).bind(...binds),
    db
      .prepare(
        `SELECT t.id, t.full_name, t.slug, t.status, t.source, t.review_count, t.created_at,
                (SELECT COUNT(*) FROM reviews r WHERE r.teacher_id = t.id AND r.status = 'pending') AS pending_reviews,
                (SELECT GROUP_CONCAT(i.name, ' · ') FROM teacher_institutions ti
                   JOIN institutions i ON i.id = ti.institution_id WHERE ti.teacher_id = t.id) AS institutions
           FROM teachers t
          WHERE ${whereSql}
          ORDER BY t.name_search, t.id
          LIMIT ? OFFSET ?`,
      )
      .bind(...binds, ADMIN_PAGE_SIZE, (filters.page - 1) * ADMIN_PAGE_SIZE),
  ]);
  const total = (count.results[0] as { total: number }).total;
  return {
    rows: rows.results as unknown as AdminTeacherRow[],
    total,
    totalPages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)),
  };
}

export interface AdminTeacherDetail {
  id: number;
  full_name: string;
  slug: string;
  status: TeacherStatus;
  source: string;
  avg_score: number | null;
  review_count: number;
  created_at: string;
  pending_reviews: number;
}

export async function getTeacherAdmin(db: D1Database, id: number) {
  const [teacher, links, sameName] = await db.batch([
    db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM reviews r WHERE r.teacher_id = t.id AND r.status = 'pending') AS pending_reviews
           FROM teachers t WHERE t.id = ?1`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT i.id, i.name, i.slug, i.reg_number, ti.subjects,
                (SELECT COUNT(*) FROM reviews r WHERE r.teacher_id = ?1 AND r.institution_id = i.id) AS reviews
           FROM teacher_institutions ti JOIN institutions i ON i.id = ti.institution_id
          WHERE ti.teacher_id = ?1
          ORDER BY i.name_search`,
      )
      .bind(id),
    // Possible duplicates, for the merge tool later
    db
      .prepare(
        `SELECT t2.id, t2.full_name, t2.status,
                (SELECT GROUP_CONCAT(i.name, ' · ') FROM teacher_institutions ti
                   JOIN institutions i ON i.id = ti.institution_id WHERE ti.teacher_id = t2.id) AS institutions
           FROM teachers t1 JOIN teachers t2 ON t2.name_search = t1.name_search AND t2.id <> t1.id
          WHERE t1.id = ?1`,
      )
      .bind(id),
  ]);
  const t = teacher.results[0] as AdminTeacherDetail | undefined;
  if (!t) return null;
  return {
    teacher: t,
    links: links.results as { id: number; name: string; slug: string; reg_number: string; subjects: string | null; reviews: number }[],
    sameName: sameName.results as { id: number; full_name: string; status: TeacherStatus; institutions: string | null }[],
  };
}

// ---------------------------------------------------------------------------
// Form actions. Each returns either a redirect target or a form state to re-render.
// ---------------------------------------------------------------------------

export interface PickerState {
  institutionInput: string;
  candidates: InstitutionChoice[];
  error: string | null;
}

/** Resolves the institution picker fields of a submitted form. */
export async function pickInstitution(
  db: D1Database,
  form: FormData,
): Promise<{ institution: InstitutionChoice | null; state: PickerState }> {
  const input = cleanLine(form.get('institution'), 200);
  const chosenId = positiveInt(form.get('institution_id'));
  const state: PickerState = { institutionInput: input, candidates: [], error: null };

  if (chosenId) {
    const inst = await db
      .prepare(`SELECT id, name, reg_number, location FROM institutions WHERE id = ?1`)
      .bind(chosenId)
      .first<InstitutionChoice>();
    if (inst) return { institution: inst, state };
  }
  if (!input) {
    state.error = 'Norādi iestādi.';
    return { institution: null, state };
  }
  const { match, candidates } = await resolveInstitution(db, input);
  if (match) return { institution: match, state };
  state.candidates = candidates;
  state.error = candidates.length ? null : `Neviena iestāde neatbilst “${input}”.`;
  return { institution: null, state };
}

export async function createTeacherFromForm(
  db: D1Database,
  form: FormData,
): Promise<{ redirect: string } | { error: string | null; picker: PickerState; fullName: string; subjects: string }> {
  const fullName = cleanLine(form.get('full_name'), NAME_MAX + 1);
  const subjects = cleanLine(form.get('subjects'), SUBJECTS_MAX);
  const { institution, state } = await pickInstitution(db, form);

  const nameError = teacherNameError(fullName);
  if (nameError) return { error: nameError, picker: state, fullName, subjects };
  if (!institution) return { error: state.error, picker: state, fullName, subjects };

  const existing = await db
    .prepare(
      `SELECT t.id, t.status FROM teachers t JOIN teacher_institutions ti ON ti.teacher_id = t.id
        WHERE t.name_search = ?1 AND ti.institution_id = ?2 LIMIT 1`,
    )
    .bind(normalizeForSearch(fullName), institution.id)
    .first<{ id: number; status: TeacherStatus }>();
  if (existing) {
    return {
      error:
        existing.status === 'removed'
          ? 'Šis pedagogs šajā iestādē ir dzēsts pēc pieprasījuma, tāpēc to nevar pievienot atkārtoti.'
          : `Pedagogs ar šādu vārdu šajā iestādē jau ir (ID ${existing.id}).`,
      picker: state,
      fullName,
      subjects,
    };
  }

  const [slug] = await createTeachers(db, [{ fullName, institutionId: institution.id, subjects: subjects || null }], {
    status: 'active',
    source: 'admin',
  });
  const created = await db.prepare(`SELECT id FROM teachers WHERE slug = ?1`).bind(slug).first<{ id: number }>();
  return { redirect: `/admin/pedagogi/${created!.id}?msg=created` };
}

/**
 * Merges `sourceId` into `targetId` (same person, two records): moves reviews and institution
 * links, keeps the source's old address as a redirect, deletes the source, recalculates scores.
 * Removed (GDPR) teachers can't be merged either way, so a merge never brings their reviews back.
 */
export async function mergeTeachers(db: D1Database, sourceId: number, targetId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  if (sourceId === targetId) return { ok: false, error: 'Pedagogu nevar apvienot pašu ar sevi.' };
  const { results } = await db
    .prepare(`SELECT id, status FROM teachers WHERE id IN (?1, ?2)`)
    .bind(sourceId, targetId)
    .all<{ id: number; status: TeacherStatus }>();
  const source = results.find((t) => t.id === sourceId);
  const target = results.find((t) => t.id === targetId);
  if (!source || !target) return { ok: false, error: 'Pedagogs nav atrasts.' };
  if (source.status === 'removed' || target.status === 'removed') {
    return { ok: false, error: 'Pedagogus ar statusu “Dzēsts (pieprasījums)” nevar apvienot.' };
  }
  if (target.status === 'pending') return { ok: false, error: 'Mērķa pedagogs vēl nav apstiprināts.' };

  await db.batch([
    // Institution links: keep the target's subjects, fill gaps from the source.
    db
      .prepare(
        `INSERT INTO teacher_institutions (teacher_id, institution_id, subjects)
         SELECT ?2, institution_id, subjects FROM teacher_institutions WHERE teacher_id = ?1
         ON CONFLICT(teacher_id, institution_id) DO UPDATE SET subjects = COALESCE(teacher_institutions.subjects, excluded.subjects)`,
      )
      .bind(sourceId, targetId),
    db.prepare(`UPDATE reviews SET teacher_id = ?2 WHERE teacher_id = ?1`).bind(sourceId, targetId),
    // Earlier merges into the source now point at the target; the source's own address too.
    db.prepare(`UPDATE teacher_slug_redirects SET teacher_id = ?2 WHERE teacher_id = ?1`).bind(sourceId, targetId),
    db.prepare(`INSERT INTO teacher_slug_redirects (slug, teacher_id) SELECT slug, ?2 FROM teachers WHERE id = ?1`).bind(sourceId, targetId),
    db.prepare(`DELETE FROM teacher_institutions WHERE teacher_id = ?1`).bind(sourceId),
    db.prepare(`DELETE FROM teachers WHERE id = ?1`).bind(sourceId),
    ...teacherAggregateStatements(db, [targetId]),
    ...institutionsOfTeacherStatements(db, targetId),
  ]);
  return { ok: true };
}

/** Name/status change; recalculates cached scores when the status changes. */
export async function updateTeacher(db: D1Database, id: number, form: FormData, current: AdminTeacherDetail) {
  const fullName = cleanLine(form.get('full_name'), NAME_MAX + 1);
  const status = String(form.get('status') ?? '') as TeacherStatus;
  const nameError = teacherNameError(fullName);
  if (nameError) return { error: nameError };
  if (!EDITABLE_STATUSES.includes(status)) return { error: 'Nederīgs statuss.' };

  const statements = [
    db
      .prepare(`UPDATE teachers SET full_name = ?1, name_search = ?2, status = ?3 WHERE id = ?4`)
      .bind(fullName, normalizeForSearch(fullName), status, id),
  ];
  if (status !== current.status) {
    statements.push(...teacherAggregateStatements(db, [id]), ...institutionsOfTeacherStatements(db, id));
  }
  await db.batch(statements);
  return { error: null };
}

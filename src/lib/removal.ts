// GDPR removal / objection requests (plan.md §9). Public form → admin queue → resolution.

import { EMAIL_RE } from './replies';
import { cleanComment } from './reviews';
import { institutionsOfTeacherStatements, teacherAggregateStatements } from './scoring';
import { cleanLine } from './validate';

/**
 * Takes a teacher page down after a request: status 'removed' hides the teacher and all of
 * their reviews, drops them from institution scores, and blocks re-creation by import or
 * suggestion. Reversible by an admin on the teacher's CMS page.
 */
export async function removeTeacherForRequest(db: D1Database, teacherId: number): Promise<boolean> {
  const [update] = await db.batch([
    db.prepare(`UPDATE teachers SET status = 'removed' WHERE id = ?1 AND status <> 'removed'`).bind(teacherId),
    ...teacherAggregateStatements(db, [teacherId]),
    ...institutionsOfTeacherStatements(db, teacherId),
  ]);
  return update.meta.changes > 0;
}

export type RequestTargetType = 'teacher' | 'review';
export type Relation = 'teacher' | 'institution' | 'other';
export type RequestStatus = 'open' | 'granted' | 'partially_granted' | 'denied';

export const RELATION_LABELS: Record<Relation, string> = {
  teacher: 'Esmu pedagogs, par kuru ir šī lapa vai atsauksme',
  institution: 'Pārstāvu izglītības iestādi',
  other: 'Cits',
};

export const STATUS_LABELS: Record<RequestStatus, string> = {
  open: 'Atvērts',
  granted: 'Apmierināts',
  partially_granted: 'Daļēji apmierināts',
  denied: 'Noraidīts',
};

export const MESSAGE_MIN = 20;
export const MESSAGE_MAX = 3000;

export interface RequestTarget {
  type: RequestTargetType;
  id: number;
  /** Human-readable description for the form and the CMS */
  title: string;
  detail: string | null;
  url: string;
}

/** Only content that is public can be the subject of a request. */
export async function loadTarget(db: D1Database, type: RequestTargetType, id: number): Promise<RequestTarget | null> {
  if (type === 'teacher') {
    const t = await db
      .prepare(`SELECT id, full_name, slug FROM teachers WHERE id = ?1 AND status = 'active'`)
      .bind(id)
      .first<{ id: number; full_name: string; slug: string }>();
    return t ? { type, id: t.id, title: `Pedagoga lapa: ${t.full_name}`, detail: null, url: `/pedagogi/${t.slug}` } : null;
  }
  const r = await db
    .prepare(
      `SELECT r.id, r.comment, t.full_name, t.slug FROM reviews r JOIN teachers t ON t.id = r.teacher_id AND t.status = 'active'
        WHERE r.id = ?1 AND r.status = 'approved'`,
    )
    .bind(id)
    .first<{ id: number; comment: string; full_name: string; slug: string }>();
  if (!r) return null;
  const excerpt = r.comment.length > 160 ? `${r.comment.slice(0, 160).trimEnd()}…` : r.comment;
  return { type, id: r.id, title: `Atsauksme par pedagogu ${r.full_name}`, detail: excerpt, url: `/pedagogi/${r.slug}#atsauksme-${r.id}` };
}

/**
 * Resolves a target from query/form fields (?pedagogs=<slug> or ?atsauksme=<id>) or from a
 * pasted link to a teacher page or a review on this site.
 */
export async function resolveTarget(
  db: D1Database,
  input: { teacherSlug?: string | null; reviewId?: string | null; link?: string | null },
): Promise<RequestTarget | null> {
  const reviewId = Number(input.reviewId);
  if (Number.isInteger(reviewId) && reviewId > 0) return loadTarget(db, 'review', reviewId);

  let slug = input.teacherSlug ?? null;
  const link = (input.link ?? '').trim();
  if (!slug && link) {
    const reviewMatch = link.match(/atsauksme-(\d+)/);
    if (reviewMatch) return loadTarget(db, 'review', Number(reviewMatch[1]));
    slug = link.match(/\/pedagogi\/([a-z0-9-]+)/)?.[1] ?? null;
  }
  if (!slug) return null;
  const t = await db.prepare(`SELECT id FROM teachers WHERE slug = ?1`).bind(slug).first<{ id: number }>();
  return t ? loadTarget(db, 'teacher', t.id) : null;
}

export interface RequestValues {
  name: string;
  email: string;
  relation: Relation | '';
  message: string;
  consent: boolean;
}

export function parseRequestForm(form: FormData): { values: RequestValues; errors: Record<string, string> } {
  const relation = String(form.get('relation') ?? '');
  const values: RequestValues = {
    name: cleanLine(form.get('name'), 101),
    email: cleanLine(form.get('email'), 255).toLowerCase(),
    relation: relation in RELATION_LABELS ? (relation as Relation) : '',
    message: cleanComment(form.get('message')),
    consent: form.get('consent') === 'on',
  };
  const errors: Record<string, string> = {};
  if (values.name.length < 2 || values.name.length > 100) errors.name = 'Norādiet savu vārdu un uzvārdu.';
  if (!EMAIL_RE.test(values.email) || values.email.length > 254) errors.email = 'Norādiet derīgu e-pasta adresi.';
  if (!values.relation) errors.relation = 'Izvēlieties savu saistību ar šo saturu.';
  const length = [...values.message].length;
  if (length < MESSAGE_MIN) errors.message = `Aprakstiet pieprasījumu vismaz ${MESSAGE_MIN} rakstzīmēs.`;
  else if (length > MESSAGE_MAX) errors.message = `Apraksts nedrīkst būt garāks par ${MESSAGE_MAX} rakstzīmēm.`;
  if (!values.consent) errors.consent = 'Bez piekrišanas mēs nevaram apstrādāt pieprasījumu.';
  return { values, errors };
}

export async function submitRequest(db: D1Database, target: RequestTarget, values: RequestValues): Promise<void> {
  await db
    .prepare(
      `INSERT INTO removal_requests (requester_name, requester_email, relation, target_type, target_id, message)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(values.name, values.email, values.relation, target.type, target.id, values.message)
    .run();
}

// ---------------------------------------------------------------------------
// CMS
// ---------------------------------------------------------------------------

export interface RemovalRequest {
  id: number;
  requester_name: string;
  requester_email: string;
  relation: Relation;
  target_type: RequestTargetType;
  target_id: number;
  message: string;
  status: RequestStatus;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
  resolver_email: string | null;
}

export async function listRequests(db: D1Database, open: boolean): Promise<RemovalRequest[]> {
  const { results } = await db
    .prepare(
      `SELECT q.*, a.email AS resolver_email FROM removal_requests q LEFT JOIN admin_users a ON a.id = q.resolved_by
        WHERE (?1 = 1 AND q.status = 'open') OR (?1 = 0 AND q.status <> 'open')
        ORDER BY ${open ? 'q.created_at ASC' : 'q.resolved_at DESC'}, q.id
        LIMIT 200`,
    )
    .bind(open ? 1 : 0)
    .all<RemovalRequest>();
  return results;
}

export async function getRequest(db: D1Database, id: number): Promise<RemovalRequest | null> {
  return db
    .prepare(`SELECT q.*, a.email AS resolver_email FROM removal_requests q LEFT JOIN admin_users a ON a.id = q.resolved_by WHERE q.id = ?1`)
    .bind(id)
    .first<RemovalRequest>();
}

/** Current state of the request's subject, whatever its status now (for the CMS). */
export async function describeTargetForAdmin(db: D1Database, q: RemovalRequest) {
  if (q.target_type === 'teacher') {
    const t = await db
      .prepare(`SELECT id, full_name, slug, status, review_count FROM teachers WHERE id = ?1`)
      .bind(q.target_id)
      .first<{ id: number; full_name: string; slug: string; status: string; review_count: number }>();
    return { kind: 'teacher' as const, teacher: t };
  }
  const r = await db
    .prepare(
      `SELECT r.id, r.status, r.comment, r.edited_by_moderator, t.full_name AS teacher_name, t.slug AS teacher_slug
         FROM reviews r JOIN teachers t ON t.id = r.teacher_id WHERE r.id = ?1`,
    )
    .bind(q.target_id)
    .first<{ id: number; status: string; comment: string; edited_by_moderator: number; teacher_name: string; teacher_slug: string }>();
  return { kind: 'review' as const, review: r };
}

export async function resolveRequest(
  db: D1Database,
  id: number,
  adminId: number,
  status: RequestStatus,
  note: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (status === 'open') return { ok: false, error: 'Izvēlieties lēmumu.' };
  if (status !== 'granted' && !note) return { ok: false, error: 'Ja pieprasījums nav pilnībā apmierināts, norādiet pamatojumu.' };
  const result = await db
    .prepare(
      `UPDATE removal_requests SET status = ?3, resolution_note = NULLIF(?4, ''), resolved_at = datetime('now'), resolved_by = ?2
        WHERE id = ?1 AND status = 'open'`,
    )
    .bind(id, adminId, status, note)
    .run();
  return result.meta.changes ? { ok: true } : { ok: false, error: 'Šis pieprasījums jau ir izskatīts.' };
}

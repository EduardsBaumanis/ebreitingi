// Rating criteria and review tags (CMS, admins only).
//
// Rules: anything already used in a review can only be deactivated, never deleted, so old
// reviews keep their scores and tags. At least one criterion must stay active (the review form
// needs something to score). Changes affect new reviews only; overall scores already saved
// are never recalculated from a different set of criteria.

import { cleanLine, positiveInt } from './validate';

export type Sentiment = 'positive' | 'neutral' | 'negative';
export const SENTIMENT_LABELS: Record<Sentiment, string> = { positive: 'Pozitīva', neutral: 'Neitrāla', negative: 'Negatīva' };

export interface CriterionRow {
  id: number;
  label: string;
  description: string | null;
  sort_order: number;
  active: number;
  used: number;
}

export interface TagRow {
  id: number;
  label: string;
  sentiment: Sentiment;
  sort_order: number;
  active: number;
  used: number;
}

export type Result = { ok: true } | { ok: false; error: string };

export async function listTaxonomy(db: D1Database) {
  const [criteria, tags] = await db.batch([
    db.prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM review_scores WHERE criterion_id = c.id) AS used
         FROM criteria c ORDER BY c.active DESC, c.sort_order, c.id`,
    ),
    db.prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM review_tags WHERE tag_id = t.id) AS used
         FROM tags t ORDER BY t.active DESC, t.sort_order, t.id`,
    ),
  ]);
  return { criteria: criteria.results as unknown as CriterionRow[], tags: tags.results as unknown as TagRow[] };
}

function parseCommon(form: FormData) {
  const label = cleanLine(form.get('label'), 41);
  const sortRaw = Number(form.get('sort_order'));
  const sortOrder = Number.isInteger(sortRaw) && sortRaw >= 0 && sortRaw <= 999 ? sortRaw : 0;
  const active = form.get('active') === 'on' ? 1 : 0;
  const error = label.length < 2 || label.length > 40 ? 'Nosaukumam jābūt 2–40 rakstzīmes garam.' : null;
  return { label, sortOrder, active, error };
}

export async function saveCriterion(db: D1Database, form: FormData): Promise<Result> {
  const id = positiveInt(form.get('id'));
  const { label, sortOrder, active, error } = parseCommon(form);
  const description = cleanLine(form.get('description'), 121);
  if (error) return { ok: false, error };
  if (description.length > 120) return { ok: false, error: 'Aprakstam jābūt ne garākam par 120 rakstzīmēm.' };

  if (id && !active) {
    const others = await db
      .prepare(`SELECT COUNT(*) AS n FROM criteria WHERE active = 1 AND id <> ?1`)
      .bind(id)
      .first<{ n: number }>();
    if (!others?.n) return { ok: false, error: 'Vismaz vienam kritērijam jābūt aktīvam.' };
  }

  if (id) {
    await db
      .prepare(`UPDATE criteria SET label = ?2, description = NULLIF(?3, ''), sort_order = ?4, active = ?5 WHERE id = ?1`)
      .bind(id, label, description, sortOrder, active)
      .run();
  } else {
    await db
      .prepare(`INSERT INTO criteria (label, description, sort_order, active) VALUES (?1, NULLIF(?2, ''), ?3, 1)`)
      .bind(label, description, sortOrder)
      .run();
  }
  return { ok: true };
}

export async function saveTag(db: D1Database, form: FormData): Promise<Result> {
  const id = positiveInt(form.get('id'));
  const { label, sortOrder, active, error } = parseCommon(form);
  const sentiment = String(form.get('sentiment') ?? '') as Sentiment;
  if (error) return { ok: false, error };
  if (!(sentiment in SENTIMENT_LABELS)) return { ok: false, error: 'Izvēlieties birkas noskaņu.' };

  if (id) {
    await db
      .prepare(`UPDATE tags SET label = ?2, sentiment = ?3, sort_order = ?4, active = ?5 WHERE id = ?1`)
      .bind(id, label, sentiment, sortOrder, active)
      .run();
  } else {
    await db
      .prepare(`INSERT INTO tags (label, sentiment, sort_order, active) VALUES (?1, ?2, ?3, 1)`)
      .bind(label, sentiment, sortOrder)
      .run();
  }
  return { ok: true };
}

/** Deletes a criterion or tag that no review has used. */
export async function deleteUnused(db: D1Database, kind: 'criterion' | 'tag', id: number): Promise<Result> {
  if (kind === 'criterion') {
    const row = await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM review_scores WHERE criterion_id = ?1) AS used,
                (SELECT COUNT(*) FROM criteria WHERE active = 1 AND id <> ?1) AS other_active`,
      )
      .bind(id)
      .first<{ used: number; other_active: number }>();
    if (row?.used) return { ok: false, error: 'Kritērijs jau izmantots atsauksmēs; to var tikai deaktivizēt.' };
    if (!row?.other_active) return { ok: false, error: 'Vismaz vienam kritērijam jābūt aktīvam.' };
    await db.prepare(`DELETE FROM criteria WHERE id = ?1`).bind(id).run();
  } else {
    const row = await db.prepare(`SELECT COUNT(*) AS used FROM review_tags WHERE tag_id = ?1`).bind(id).first<{ used: number }>();
    if (row?.used) return { ok: false, error: 'Birka jau izmantota atsauksmēs; to var tikai deaktivizēt.' };
    await db.prepare(`DELETE FROM tags WHERE id = ?1`).bind(id).run();
  }
  return { ok: true };
}

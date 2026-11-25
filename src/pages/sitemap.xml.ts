import type { APIRoute } from 'astro';
import { VEIDI } from '../lib/veidi';

// One sitemap is enough: the limit is 50,000 URLs (we have ~1,500 institutions plus teachers).
export const GET: APIRoute = async ({ locals, url }) => {
  const db = locals.runtime.env.DB;
  const [institutions, teachers] = await db.batch<{ slug: string; lastmod: string | null }>([
    db.prepare(`SELECT slug, substr(updated_at, 1, 10) AS lastmod FROM institutions WHERE hidden = 0 ORDER BY id`),
    db.prepare(
      `SELECT t.slug,
              substr(COALESCE((SELECT MAX(moderated_at) FROM reviews r WHERE r.teacher_id = t.id AND r.status = 'approved'), t.created_at), 1, 10) AS lastmod
         FROM teachers t WHERE t.status = 'active' ORDER BY t.id`,
    ),
  ]);

  const origin = url.origin;
  const entry = (path: string, lastmod?: string | null) =>
    `<url><loc>${escapeXml(origin + path)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entry('/'),
    entry('/iestades'),
    ...VEIDI.map((v) => entry(`/iestades?veids=${v.slug}`)),
    entry('/noteikumi'),
    entry('/privatuma-politika'),
    ...institutions.results.map((i) => entry(`/iestades/${i.slug}`, i.lastmod)),
    ...teachers.results.map((t) => entry(`/pedagogi/${t.slug}`, t.lastmod)),
    '</urlset>',
  ].join('\n');

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
};

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

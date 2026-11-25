import type { APIRoute } from 'astro';

// Forms, search results and the CMS stay out of search engines (they're also marked noindex).
export const GET: APIRoute = ({ url }) =>
  new Response(
    [
      'User-agent: *',
      'Disallow: /admin',
      'Disallow: /vertet',
      'Disallow: /atbildet/',
      'Disallow: /dzesanas-pieprasijums',
      'Disallow: /meklet',
      'Disallow: /*/vertet',
      '',
      `Sitemap: ${url.origin}/sitemap.xml`,
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } },
  );

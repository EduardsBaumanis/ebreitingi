import { defineMiddleware } from 'astro:middleware';
import { findActiveAdmin, getAccessEmail } from './lib/auth';
import { applySecurityHeaders } from './lib/security';

function isAdminPath(pathname: string) {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

function textResponse(status: number, body: string) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request, locals } = context;

  if (isAdminPath(url.pathname)) {
    const env = locals.runtime.env;

    // In production Cloudflare Access sits in front of /admin and adds a signed JWT.
    // We still verify it here, so a misconfigured Access policy can't expose the CMS.
    let email = await getAccessEmail(request, env);

    // Local development only: there is no Access, so use DEV_ADMIN_EMAIL from .dev.vars.
    // import.meta.env.DEV is false in production builds, so this branch is removed there.
    if (!email && import.meta.env.DEV) {
      const devEmail = (env as { DEV_ADMIN_EMAIL?: string }).DEV_ADMIN_EMAIL;
      if (devEmail) email = devEmail.toLowerCase();
    }

    if (!email) return textResponse(401, 'Nav piekļuves: nepieciešama autorizācija.');

    const admin = await findActiveAdmin(env.DB, email);
    if (!admin) return textResponse(403, `Nav piekļuves: ${email} nav CMS lietotājs.`);

    // Same-origin check for anything that changes data.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (request.headers.get('Origin') !== url.origin) {
        return textResponse(403, 'Nederīgs pieprasījuma avots.');
      }
    }

    locals.admin = admin;
  }

  const response = await next();
  applySecurityHeaders(response.headers, { production: import.meta.env.PROD, admin: isAdminPath(url.pathname) });
  return response;
});

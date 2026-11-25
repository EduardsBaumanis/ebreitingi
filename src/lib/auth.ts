import { createRemoteJWKSet, jwtVerify } from 'jose';

export type AdminRole = 'admin' | 'moderator';

export interface AdminUser {
  id: number;
  email: string;
  name: string | null;
  role: AdminRole;
}

// One key set per Access team, reused across requests in the same isolate.
const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Returns the email from a valid Cloudflare Access JWT, or null.
 * Checks signature (team's public keys), issuer, audience (the Access app's AUD tag) and expiry.
 */
export async function getAccessEmail(
  request: Request,
  env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string },
): Promise<string | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  const team = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();
  if (!token || !team || !aud) return null;

  const issuer = `https://${team}`;
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByIssuer.set(issuer, jwks);
  }

  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: aud });
    return typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function findActiveAdmin(db: D1Database, email: string): Promise<AdminUser | null> {
  return db
    .prepare('SELECT id, email, name, role FROM admin_users WHERE email = ?1 AND active = 1')
    .bind(email.toLowerCase())
    .first<AdminUser>();
}

/** For admin-only CMS pages: returns a 403 response for moderators, or null to continue. */
export function adminOnly(locals: App.Locals): Response | null {
  if (locals.admin?.role === 'admin') return null;
  return new Response('Šī sadaļa pieejama tikai administratoriem.', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export const ROLE_LABELS: Record<AdminRole, string> = {
  admin: 'Administrators',
  moderator: 'Moderators',
};

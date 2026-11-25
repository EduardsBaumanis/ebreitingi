import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminOnly, findActiveAdmin, getAccessEmail } from '../src/lib/auth';
import { addAdmin, createTestDb } from './d1';

const TEAM = 'test-team.cloudflareaccess.com';
const ISSUER = `https://${TEAM}`;
const AUD = 'test-aud-tag';
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

let privateKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  otherKey = (await generateKeyPair('RS256')).privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  // Cloudflare Access publishes its signing keys at /cdn-cgi/access/certs
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${ISSUER}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });
});
afterAll(() => vi.unstubAllGlobals());

async function token(overrides: { key?: CryptoKey; aud?: string; iss?: string; exp?: string | number; email?: string } = {}) {
  return new SignJWT({ email: overrides.email ?? 'Admin@Example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? '5m')
    .sign(overrides.key ?? privateKey);
}

const request = (jwt?: string) => new Request('https://example.lv/admin', { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} });

describe('Cloudflare Access token check', () => {
  it('accepts a valid token and returns the lowercased email', async () => {
    expect(await getAccessEmail(request(await token()), env)).toBe('admin@example.com');
  });

  it('rejects a missing header', async () => {
    expect(await getAccessEmail(request(), env)).toBeNull();
  });

  it('rejects a token signed with another key', async () => {
    expect(await getAccessEmail(request(await token({ key: otherKey })), env)).toBeNull();
  });

  it('rejects a token for another Access application (audience)', async () => {
    expect(await getAccessEmail(request(await token({ aud: 'other-app' })), env)).toBeNull();
  });

  it('rejects a token from another issuer', async () => {
    expect(await getAccessEmail(request(await token({ iss: 'https://evil.cloudflareaccess.com' })), env)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    expect(await getAccessEmail(request(await token({ exp: past })), env)).toBeNull();
  });

  it('rejects everything when Access is not configured', async () => {
    const jwt = await token();
    expect(await getAccessEmail(request(jwt), { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: AUD })).toBeNull();
    expect(await getAccessEmail(request(jwt), { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: '' })).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await getAccessEmail(request('not.a.jwt'), env)).toBeNull();
  });
});

describe('CMS users', () => {
  it('finds active users case-insensitively and ignores deactivated ones', async () => {
    const db = createTestDb();
    addAdmin(db, 'admin@example.com', 'admin');
    addAdmin(db, 'mod@example.com', 'moderator');
    db.run(`UPDATE admin_users SET active = 0 WHERE email = 'mod@example.com'`);
    expect(await findActiveAdmin(db.d1, 'ADMIN@example.com')).toMatchObject({ email: 'admin@example.com', role: 'admin' });
    expect(await findActiveAdmin(db.d1, 'mod@example.com')).toBeNull();
    expect(await findActiveAdmin(db.d1, 'nobody@example.com')).toBeNull();
  });

  it('lets only admins into admin-only pages', () => {
    const admin = { id: 1, email: 'a@x.lv', name: null, role: 'admin' as const };
    const moderator = { ...admin, role: 'moderator' as const };
    expect(adminOnly({ admin } as App.Locals)).toBeNull();
    expect(adminOnly({ admin: moderator } as App.Locals)?.status).toBe(403);
    expect(adminOnly({} as App.Locals)?.status).toBe(403);
  });
});

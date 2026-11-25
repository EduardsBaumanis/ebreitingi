#!/usr/bin/env node
// Pre-launch checks. Exits with code 1 if anything blocks a launch.
//
//   npm run launch-check -- --env production                 # configuration only
//   npm run launch-check -- --env production --remote        # + live D1 database and secrets (needs `wrangler login`)
//   npm run launch-check -- --env production --url https://… # + live site checks

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const env = opt('--env') ?? 'production';
// --local runs the database checks against the local D1 (for testing this script).
const localDb = args.includes('--local');
const remote = args.includes('--remote') || localDb;
const target = localDb ? ['--local'] : ['--remote', '--env', env];
const siteUrl = opt('--url')?.replace(/\/$/, '');
if (!['staging', 'production'].includes(env)) {
  console.error('Usage: npm run launch-check -- --env staging|production [--remote] [--url https://…]');
  process.exit(2);
}

let failed = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { failed++; console.log(`  ✗ ${msg}`); };
const warn = (msg) => console.log(`  ! ${msg}`);
const check = (condition, good, bad) => (condition ? ok(good) : fail(bad));

/** JSON with // and /* comments (wrangler.jsonc). Leaves "//" inside strings alone. */
function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function wrangler(cmdArgs) {
  const bin = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const r = spawnSync(process.execPath, [bin, ...cmdArgs], { cwd: root, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

function query(sql) {
  const r = wrangler(['d1', 'execute', 'DB', ...target, '--json', '--command', sql]);
  const start = r.out.indexOf('[');
  if (r.status !== 0 || start < 0) throw new Error(r.out.trim().split('\n').slice(-3).join(' '));
  return JSON.parse(r.out.slice(start, r.out.lastIndexOf(']') + 1))[0].results[0];
}

// ---------------------------------------------------------------------------
console.log(`\nConfiguration (${env})`);

const site = readFileSync(path.join(root, 'src/lib/site.ts'), 'utf8');
const placeholders = [...site.matchAll(/:\s*'(\[[^\]]*\])'/g)].map((m) => m[1]);
check(!placeholders.length, 'Data controller filled in (src/lib/site.ts)', `Data controller still has placeholders in src/lib/site.ts: ${placeholders.join(', ')}`);

const config = parseJsonc(readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'));
const envConfig = config.env?.[env] ?? {};
const db = envConfig.d1_databases?.[0];
check(db && !/REPLACE|^0{8}-/.test(db.database_id ?? ''), `D1 database_id set (${db?.database_name})`, `D1 database_id for ${env} is not set in wrangler.jsonc`);
const vars = envConfig.vars ?? {};
check(vars.ACCESS_TEAM_DOMAIN && !/REPLACE/.test(vars.ACCESS_TEAM_DOMAIN), 'Cloudflare Access team domain set', 'ACCESS_TEAM_DOMAIN not set');
check(vars.ACCESS_AUD && !/REPLACE/.test(vars.ACCESS_AUD), 'Cloudflare Access audience (AUD) set', 'ACCESS_AUD not set');
const siteKey = vars.TURNSTILE_SITE_KEY ?? '';
check(siteKey && !/REPLACE/.test(siteKey) && !/^[123]x0{20}/.test(siteKey), 'Turnstile site key set (not a test key)', `TURNSTILE_SITE_KEY for ${env} is missing or a test key`);
check(config.triggers?.crons?.length, `Retention Cron Trigger configured (${config.triggers?.crons?.join(', ')})`, 'No Cron Trigger: data retention will not run');
const migrations = readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql'));
ok(`${migrations.length} migrations in repo (latest ${migrations.sort().at(-1)})`);

// ---------------------------------------------------------------------------
const loggedIn = !remote || localDb || !/not authenticated|CLOUDFLARE_API_TOKEN/i.test(wrangler(['whoami']).out);
if (remote && !loggedIn) {
  console.log(`\nRemote database and secrets (${env})`);
  fail('Not logged in to Cloudflare: run "npx wrangler login" (or set CLOUDFLARE_API_TOKEN), then run this check again.');
} else if (remote) {
  console.log(localDb ? '\nLocal database (--local)' : `\nRemote database and secrets (${env})`);
  try {
    const m = wrangler(['d1', 'migrations', 'list', 'DB', ...target]);
    check(/No migrations to apply/i.test(m.out), 'All migrations applied', `Unapplied migrations: run npm run db:migrate:${env}`);

    const c = query(`SELECT
      (SELECT COUNT(*) FROM institutions) AS institutions,
      (SELECT COUNT(*) FROM institutions WHERE veids = 'Pirmsskolas izglītības iestāde') AS preschools,
      (SELECT COUNT(*) FROM criteria WHERE active = 1) AS criteria,
      (SELECT COUNT(*) FROM tags WHERE active = 1) AS tags,
      (SELECT COUNT(*) FROM admin_users WHERE active = 1 AND role = 'admin') AS admins,
      (SELECT COUNT(*) FROM admin_users WHERE active = 1 AND role = 'moderator') AS moderators,
      (SELECT COUNT(*) FROM teachers WHERE slug LIKE 'paraugs-%' OR full_name LIKE '%(paraugs)%') AS sample_teachers,
      (SELECT COUNT(*) FROM admin_users WHERE email LIKE '%@example.com') AS example_admins,
      (SELECT COUNT(*) FROM teachers) AS teachers,
      (SELECT COUNT(*) FROM reviews) AS reviews`);
    check(c.institutions >= 1000, `${c.institutions} institutions loaded`, `Only ${c.institutions} institutions: run npm run seed:build && npm run seed:${env}`);
    check(c.preschools === 0, 'No preschools', `${c.preschools} preschools present`);
    check(c.criteria >= 1, `${c.criteria} active criteria, ${c.tags} active tags`, 'No active criteria: the review form would be empty');
    check(c.admins >= 1, `${c.admins} admin(s), ${c.moderators} moderator(s)`, `No active admin: npm run admin:add -- you@… admin --env ${env}`);
    check(c.sample_teachers === 0, 'No sample (paraugs) data', `${c.sample_teachers} sample teachers present: remove before launch`);
    check(c.example_admins === 0, 'No @example.com CMS users', `${c.example_admins} @example.com CMS user(s): deactivate them`);
    console.log(`    (${c.teachers} teachers, ${c.reviews} reviews)`);
  } catch (e) {
    fail(`Could not query the remote database: ${e.message}. Did you run "npx wrangler login"?`);
  }

  if (!localDb) {
    const secrets = wrangler(['secret', 'list', '--env', env]);
    check(/TURNSTILE_SECRET_KEY/.test(secrets.out), 'TURNSTILE_SECRET_KEY secret set', `TURNSTILE_SECRET_KEY missing: npx wrangler secret put TURNSTILE_SECRET_KEY --env ${env}`);
  }
}

// ---------------------------------------------------------------------------
if (siteUrl) {
  console.log(`\nLive site (${siteUrl})`);
  try {
    const home = await fetch(siteUrl + '/', { redirect: 'manual' });
    check(home.status === 200, 'Home page responds 200', `Home page responded ${home.status}`);
    check(/script-src 'self' https:\/\/challenges\.cloudflare\.com/.test(home.headers.get('content-security-policy') ?? ''), 'Content-Security-Policy present', 'Content-Security-Policy header missing');
    check(home.headers.get('strict-transport-security'), 'HSTS present', 'Strict-Transport-Security header missing');
    const html = await home.text();
    check(!/\(paraugs\)/.test(html), 'No sample data on the home page', 'Sample (paraugs) content visible on the home page');
    for (const p of ['/iestades', '/robots.txt', '/sitemap.xml', '/privatuma-politika']) {
      const r = await fetch(siteUrl + p);
      check(r.status === 200, `${p} responds 200`, `${p} responded ${r.status}`);
    }
    const admin = await fetch(siteUrl + '/admin', { redirect: 'manual' });
    check(admin.status !== 200, `/admin is protected (${admin.status}${admin.headers.get('location') ? ' → ' + new URL(admin.headers.get('location')).host : ''})`, '/admin is reachable without logging in!');
    if (admin.status === 401) warn('/admin returned 401 from the Worker itself: is the Cloudflare Access application set up for this hostname?');
  } catch (e) {
    fail(`Could not reach ${siteUrl}: ${e.message}`);
  }
}

console.log(failed ? `\n${failed} problem(s) must be fixed before launch.\n` : '\nAll checks passed.\n');
process.exitCode = failed ? 1 : 0;

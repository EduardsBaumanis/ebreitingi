#!/usr/bin/env node
// Adds (or re-activates) a CMS user. Used to create the first admin; after that use /admin/lietotaji.
//
//   npm run admin:add -- you@example.com                     # local D1, role admin
//   npm run admin:add -- mod@example.com moderator           # local D1, role moderator
//   npm run admin:add -- you@example.com admin --env staging # remote staging D1

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2);
const envIndex = args.indexOf('--env');
const env = envIndex >= 0 ? args.splice(envIndex, 2)[1] : null;
const [rawEmail, role = 'admin'] = args;

const email = (rawEmail ?? '').trim().toLowerCase();
// The strict pattern also guarantees there are no quotes to escape in the SQL below.
if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
  console.error('Usage: npm run admin:add -- <email> [admin|moderator] [--env staging|production]');
  process.exit(1);
}
if (!['admin', 'moderator'].includes(role)) {
  console.error(`Unknown role "${role}". Use admin or moderator.`);
  process.exit(1);
}
if (env && !['staging', 'production'].includes(env)) {
  console.error(`Unknown env "${env}". Use staging or production.`);
  process.exit(1);
}

const sql =
  `INSERT INTO admin_users (email, role) VALUES ('${email}', '${role}') ` +
  `ON CONFLICT(email) DO UPDATE SET role = excluded.role, active = 1;`;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const target = env ? ['--remote', '--env', env] : ['--local'];

const result = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'DB', ...target, '--command', sql], {
  cwd: root,
  stdio: 'inherit',
});
if (result.status === 0) console.log(`\n${email} is now ${role} (${env ?? 'local'}).`);
process.exit(result.status ?? 1);

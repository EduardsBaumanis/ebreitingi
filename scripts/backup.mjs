#!/usr/bin/env node
// Exports a remote D1 database to backups/<env>-<timestamp>.sql (plan.md §10: weekly export kept
// outside Cloudflare, in addition to D1 Time Travel). Needs `npx wrangler login`.
//
//   npm run backup -- --env production
//
// The file contains personal data (teacher names, reviews, removal requests): store it
// encrypted, never commit it (backups/ is in .gitignore), and delete old exports in line with
// the retention periods.

import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const i = process.argv.indexOf('--env');
const env = i >= 0 ? process.argv[i + 1] : 'production';
if (!['staging', 'production'].includes(env)) {
  console.error('Usage: npm run backup -- --env staging|production');
  process.exit(2);
}

mkdirSync(path.join(root, 'backups'), { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const file = path.join('backups', `${env}-${stamp}.sql`);
const bin = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const result = spawnSync(process.execPath, [bin, 'd1', 'export', 'DB', '--remote', '--env', env, '--output', file], {
  cwd: root,
  stdio: 'inherit',
});
if (result.status === 0) console.log(`\nBackup written to ${file} (${Math.round(statSync(path.join(root, file)).size / 1024)} KB).`);
process.exit(result.status ?? 1);

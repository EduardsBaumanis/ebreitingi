#!/usr/bin/env node
// Browser checks for public pages: accessibility (axe-core, WCAG 2.1 A/AA), horizontal overflow
// at phone widths, and Content-Security-Policy violations. Needs a running site and a
// Chromium-based browser (Edge or Chrome).
//
//   npm run build && npx wrangler dev          # production build (CSP active)
//   npm run test:a11y                          # checks http://127.0.0.1:8787
//   npm run test:a11y -- http://localhost:4321 --admin   # dev server, also CMS pages
//
// Set BROWSER=/path/to/chrome if Edge/Chrome isn't found automatically.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const includeAdmin = args.includes('--admin');
const axeSource = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');

const BROWSERS = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/microsoft-edge',
].filter(Boolean);
const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) {
  console.error('No Chromium-based browser found. Set BROWSER=/path/to/chrome.');
  process.exit(2);
}

// Pick real pages from the sitemap so the check works with any data.
const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
const institution = locs.find((p) => p.startsWith('/iestades/'));
const teacher = locs.find((p) => p.startsWith('/pedagogi/'));

const pages = [
  '/',
  '/iestades',
  '/iestades?veids=augstaka',
  institution,
  teacher,
  teacher && `${teacher}/vertet`,
  '/vertet',
  institution && `/vertet?iestade=${institution.split('/').pop()}`,
  '/meklet?q=rigas',
  '/noteikumi',
  '/privatuma-politika',
  '/dzesanas-pieprasijums',
  '/lapa-kas-neeksiste',
  ...(includeAdmin ? ['/admin', '/admin/atsauksmes', '/admin/pedagogi', '/admin/kriteriji', '/admin/lietotaji', '/admin/palidziba'] : []),
].filter(Boolean);

const port = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'a11y-'));
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 50 && !target; i++) {
  await new Promise((r) => setTimeout(r, 200));
  target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json()).catch(() => null);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let msgId = 0;
const waiting = new Map();
const events = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  else if (m.method) events.push(m);
});
const send = (method, params = {}) => new Promise((res) => { const i = ++msgId; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result?.value;
const loaded = () => new Promise((res) => { const t = setInterval(() => { const i = events.findIndex((e) => e.method === 'Page.loadEventFired'); if (i >= 0) { events.splice(i, 1); clearInterval(t); res(); } }, 50); });

await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || 'inline')));`,
});

let failures = 0;
for (const path of pages) {
  const problems = [];
  let rulesChecked = 0;
  for (const width of [1280, 390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    const done = loaded();
    await send('Page.navigate', { url: base + path });
    await done;
    await new Promise((r) => setTimeout(r, 400));
    const overflow = await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    if (overflow > 0) problems.push(`${width}px: horizontal overflow of ${overflow}px`);
    if (width === 1280) {
      await evaluate(axeSource);
      const result = await evaluate(
        `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, iframes: false })
           .then(r => ({ passes: r.passes.length, violations: r.violations.map(v => v.id + ' (' + v.impact + '): ' + v.help + ' → ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(', ')) }))`,
      );
      rulesChecked = result.passes + result.violations.length;
      problems.push(...result.violations);
      const csp = await evaluate('window.__csp');
      problems.push(...csp.map((c) => `CSP blocked: ${c}`));
    }
  }
  console.log(`${problems.length ? '✗' : '✓'} ${path}  (${rulesChecked} axe rules applied; 1280/390/320 px)`);
  for (const p of problems) console.log(`    ${p}`);
  failures += problems.length;
}

ws.close();
// Remove the temporary browser profile once the browser has really exited (Windows keeps files locked until then).
browser.once('exit', () => {
  setTimeout(() => {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      /* leftover temp folder is harmless */
    }
  }, 300);
});
browser.kill();
console.log(failures ? `\n${failures} problem(s) found.` : '\nNo problems found.');
process.exitCode = failures ? 1 : 0;

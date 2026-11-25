// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    // `astro dev` gets the D1 binding (local SQLite in .wrangler/state) from wrangler.jsonc
    platformProxy: { enabled: true },
    // No image optimisation needed (and sharp doesn't run on Workers).
    imageService: 'passthrough',
    // Adds the daily data-retention Cron Trigger handler next to Astro's fetch handler.
    workerEntryPoint: { path: 'src/worker.ts' },
  }),
  build: {
    // Always ship CSS as files, never inline <style>, so the Content-Security-Policy can
    // forbid inline styles (see src/lib/security.ts).
    inlineStylesheets: 'never',
  },
});

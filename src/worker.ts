// Custom Worker entry point: Astro's request handler plus a daily Cron Trigger for data
// retention (see wrangler.jsonc "triggers" and src/lib/retention.ts).
import type { SSRManifest } from 'astro';
import { App } from 'astro/app';
import { handle } from '@astrojs/cloudflare/handler';
import { runRetention } from './lib/retention';

export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);
  return {
    default: {
      async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        // @ts-expect-error: the adapter's handler types use @cloudflare/workers-types; the runtime objects are the same.
        return handle(manifest, app, request, env, ctx);
      },
      async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
        ctx.waitUntil(
          runRetention(env.DB).then((deleted) => console.log('retention', JSON.stringify(deleted))),
        );
      },
    } satisfies ExportedHandler<Env>,
  };
}

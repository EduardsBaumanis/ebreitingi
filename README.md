# Pedagogu vērtējumi

An anonymous site where students rate teachers and professors. Reviews are moderated before they are published. The project plan is in [plan.md](plan.md).

Stack: Astro 5 (SSR) on Cloudflare Workers, Cloudflare D1, Cloudflare Access for the CMS.

## Local development

Requirements: Node.js 20 or newer, and Python 3 (used only for the seed script).

```sh
npm install
cp .dev.vars.example .dev.vars          # sets DEV_ADMIN_EMAIL for /admin
npm run db:migrate:local                # create tables + default criteria/tags
npm run seed:build                      # pa_veidiem/*.csv → seed/institutions.sql
npm run seed:local                      # load 1,443 institutions into local D1
npm run admin:add -- admin@example.com  # same email as in .dev.vars
npm run dev                             # http://localhost:4321
```

Optional: `npm run dev:sample` adds a few sample teachers and reviews (names end in "(paraugs)") so you can see scores on the pages. `npm run dev:sample:clear` removes them. These commands only touch the local database.

The local D1 database is stored in `.wrangler/state/`. To start again from scratch, delete that folder and repeat the steps.

`/admin` locally: there is no Cloudflare Access during development, so the site treats you as `DEV_ADMIN_EMAIL`. That email must exist in `admin_users`, which is what the `admin:add` step above does. Production builds remove this shortcut.

## Environments

| Environment | Worker | D1 database | Command |
|---|---|---|---|
| local | `astro dev` | local SQLite | `npm run dev` |
| staging | `pedagogu-vertejumi-staging` | `pedagogu-vertejumi-staging` | `npm run deploy:staging` |
| production | `pedagogu-vertejumi` | `pedagogu-vertejumi-production` | `npm run deploy:production` |

### One-time Cloudflare setup (for each of staging and production)

1. **Log in:** `npx wrangler login`
2. **Create the database:** `npx wrangler d1 create pedagogu-vertejumi-staging`. Copy the `database_id` it prints into `env.staging` in [wrangler.jsonc](wrangler.jsonc).
3. **Create tables and load data:**
   ```sh
   npm run db:migrate:staging
   npm run seed:build && npm run seed:staging
   npm run admin:add -- you@example.com admin --env staging
   ```
4. **Set up Turnstile** (spam protection on the review form):
   - In the Cloudflare dashboard → Turnstile → Add widget, add the site's hostname and choose the *Managed* mode.
   - Copy the **site key** to `TURNSTILE_SITE_KEY` under `env.staging.vars` in `wrangler.jsonc`.
   - Store the **secret key** with `npx wrangler secret put TURNSTILE_SECRET_KEY --env staging`.

   Without the secret, the form refuses every review. Locally, Cloudflare's test keys (in `wrangler.jsonc` and `.dev.vars`) always pass.
5. **Deploy:** `npm run deploy:staging`
6. **Set up Cloudflare Access** (Zero Trust dashboard → Access → Applications → Add → Self-hosted):
   - **Domain:** the Worker's hostname, path `admin`. Add a second entry for the path `admin/*`.
   - **Policy:** Allow, with a rule *Emails* listing every CMS user (or *Emails ending in* your domain).
   - **Login methods:** One-time PIN (and Google, if you want it).
   - Copy the application's **Audience (AUD) tag** to `ACCESS_AUD`, and your team domain (`<team>.cloudflareaccess.com`) to `ACCESS_TEAM_DOMAIN`, under `env.staging.vars` in `wrangler.jsonc`. Then deploy again.

The Worker verifies the Access token itself and looks up the user's role in `admin_users`. Requests without a valid token get a 401, and emails that aren't in `admin_users` (or are deactivated) get a 403.

## Data

- **Institutions:** imported from `pa_veidiem/*.csv` (`;`-separated, UTF-8). The import:
  - skips preschools
  - stores the export's placeholder `-Nav norādīts-` as NULL
  - upserts on the registration number, so a newer export can be re-imported safely
  - never changes an existing institution's slug
- **Schema changes:** add a new file to `migrations/` (`npx wrangler d1 migrations create DB <name>`). Never edit a migration that has already been applied.

## Security and privacy

- **Security headers:** every page gets them from [src/lib/security.ts](src/lib/security.ts). The strict Content-Security-Policy allows only the site's own files plus Cloudflare Turnstile, with no inline scripts or styles. That's why CSS is built as files and JavaScript lives in `public/js/`. The policy applies only to production builds, because the dev server injects inline scripts.
- **Data retention:** a daily Cron Trigger (`triggers.crons` in `wrangler.jsonc`, handler in [src/worker.ts](src/worker.ts)) deletes data whose retention period has passed. The periods are set in [src/lib/retention.ts](src/lib/retention.ts), and the privacy policy shows the same values.
  - To run the job locally:
    1. Start the Worker with `npx wrangler dev --test-scheduled`.
    2. Send `POST /cdn-cgi/local/explorer/api/local/scheduled?worker=pedagogu-vertejumi-dev` with the body `{"cron":"17 3 * * *"}`.

## Launch

Follow [docs/launch-runbook.md](docs/launch-runbook.md) step by step. `npm run launch-check -- --env production --remote` must report "All checks passed" before you deploy production.

- **Legal review:** [docs/legal/legal-review-brief.md](docs/legal/legal-review-brief.md) and the [legitimate interest assessment](docs/legal/legitimate-interest-assessment.md).
- **Moderator handbook:** in the CMS under **Palīdzība** (`/admin/palidziba`).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Astro dev server with local D1 |
| `npm run check` | Type-check |
| `npm test` | Unit and database tests (Vitest; runs the real SQL and migrations on Node's built-in SQLite) |
| `npm run test:a11y -- [url] [--admin]` | Browser checks on a running site: accessibility (axe-core, WCAG 2.1 AA), sideways scrolling at 390/320 px, and anything the security policy blocks. Default URL is `wrangler dev` on port 8787 |
| `npm run preview` | Build, then run the real Worker locally with `wrangler dev` |
| `npm run db:migrate:{local,staging,production}` | Apply D1 migrations |
| `npm run seed:build` | Generate `seed/institutions.sql` from the CSVs |
| `npm run seed:{local,staging,production}` | Load the institutions |
| `npm run dev:sample` / `dev:sample:clear` | Add or remove local sample teachers and reviews |
| `npm run admin:add -- <email> [admin\|moderator] [--env staging\|production]` | Add or re-activate a CMS user |
| `npm run deploy:{staging,production}` | Build and deploy |
| `npm run launch-check -- --env <env> [--remote] [--url https://…]` | Pre-launch checks: configuration, the live database and secrets, the live site |
| `npm run backup -- --env <env>` | Export the remote D1 database to `backups/` (not committed) |

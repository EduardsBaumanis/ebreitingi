# Launch runbook

The step-by-step guide to going live (plan.md week 8). Do the steps in order. Each step names the command that checks it.

| | Who | Needs |
|---|---|---|
| Steps 1–7 | Project owner | Cloudflare account (free plan is enough), GitHub access |
| Step 8 | Project owner and lawyer | Legal review ([legal/legal-review-brief.md](legal/legal-review-brief.md)) |
| Step 9 | Admins and moderators | Onboarding |

---

## 1. Commit the code

The code must be committed and pushed before anything is deployed. The working copy is the only copy until then.

```sh
git add -A && git commit -m "Pedagogu vērtējumi MVP" && git push
```

## 2. Log in to Cloudflare

```sh
npx wrangler login
npx wrangler whoami
```

## 3. Create resources (staging first, then production)

For `<env>` = `staging`, then `production`:

1. **Database:**
   - Run `npx wrangler d1 create pedagogu-vertejumi-<env>`.
   - Copy the `database_id` it prints into `env.<env>.d1_databases[0].database_id` in `wrangler.jsonc`.
2. **Turnstile:** in the dashboard, go to Turnstile → Add widget.
   - Hostname: the site's domain. Mode: *Managed*.
   - Copy the site key into `env.<env>.vars.TURNSTILE_SITE_KEY`.
   - Set the secret with `npx wrangler secret put TURNSTILE_SECRET_KEY --env <env>`.
3. **Domain:** in the dashboard, go to Workers → `pedagogu-vertejumi[-staging]` → Settings → Domains & Routes → Add custom domain. The domain must be on Cloudflare DNS. You can also use the free `*.workers.dev` address for staging.
4. **Cloudflare Access** (Zero Trust → Access → Applications → Add → Self-hosted):
   - **Application domain:** `<domain>/admin`. Add `<domain>/admin/*` too.
   - **Policy:** *Allow*, with a rule listing the CMS users' emails.
   - **Login methods:** One-time PIN.
   - Copy the **Application Audience (AUD) tag** into `env.<env>.vars.ACCESS_AUD`, and `<team>.cloudflareaccess.com` into `ACCESS_TEAM_DOMAIN`.

## 4. Database

```sh
npm run db:migrate:<env>                 # creates all tables
npm run seed:build && npm run seed:<env> # 1,443 institutions
npm run admin:add -- you@example.lv admin --env <env>
```

Never run `npm run dev:sample` against staging or production. It only works on the local database, and the launch check flags any sample data.

## 5. Deploy staging and test it

```sh
npm test
npm run deploy:staging
npm run launch-check -- --env staging --remote --url https://<staging-domain>
npm run test:a11y -- https://<staging-domain>
```

Then test by hand on staging:

1. **Review flow:**
   - Submit a review from a phone: Turnstile should appear and the thank-you page should show.
   - Open `/admin`: you're asked to log in through Cloudflare Access. Approve the review and check that it appears with its score.
2. **Other forms:**
   - Submit a teacher reply and a removal request, and process both in the CMS.
3. **Clean up:** delete the test data. Staging can keep test data; production must start clean.

## 6. Deploy production

Before deploying, fill in the controller details in `src/lib/site.ts` (after the legal review, step 8).

```sh
npm run launch-check -- --env production --remote     # must show "All checks passed"
npm run deploy:production
npm run launch-check -- --env production --remote --url https://<domain>
```

Then submit one real review yourself to confirm everything works end to end, and approve it.

## 7. After launch

- **Logs:** dashboard → Workers → `pedagogu-vertejumi` → Logs. Observability is enabled in `wrangler.jsonc`. The retention job logs a `retention {…}` line every day at 03:17 UTC; check it the day after launch.
- **Backups, weekly:** run `npm run backup -- --env production`. This writes `backups/production-<date>.sql`. Store the file encrypted outside Cloudflare, and delete exports older than 12 months.
- **Restore** (D1 Time Travel keeps 30 days):
  ```sh
  npx wrangler d1 time-travel info DB --env production --timestamp "2026-12-01T10:00:00Z"
  npx wrangler d1 time-travel restore DB --env production --bookmark <bookmark>
  ```
- **Roll back code:** `npx wrangler rollback --env production`. This switches to the previous Worker version; database migrations are not undone.
- **Search engines:** submit `https://<domain>/sitemap.xml` in Google Search Console.

## 8. Legal review (before step 6)

Send the documents listed in [legal/legal-review-brief.md](legal/legal-review-brief.md). Apply the changes it asks for, fill in `src/lib/site.ts`, and redeploy.

## 9. Moderator onboarding

For each moderator:

1. Add their email to the Cloudflare Access policy (step 3.4).
2. In the CMS, under **CMS lietotāji**, add them with the role *Moderators*.
3. Ask them to read **Palīdzība** (`/admin/palidziba`), the moderator handbook, and then moderate a few reviews alongside an admin.

Recommended: at least two moderators, so the queue stays under 3 days. Check the age of the oldest pending item on the dashboard every day during the first weeks.

## First-week checklist

- [ ] Retention job ran (log line `retention {…}`)
- [ ] Queue age under 3 days
- [ ] No errors in Worker logs
- [ ] First backup taken and stored
- [ ] Removal request inbox checked (30-day deadline)

# Teacher Rating Website: Project Plan

A Latvian-language website where students anonymously rate their teachers and professors and give feedback on the quality of their education. Every review is checked in a custom admin CMS before it is published. The site runs on Cloudflare Workers with a Cloudflare D1 database.

---

## 1. Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Institutions | 1,443 institutions: every type in the export except preschools (8 of 9 types). Source: `pa_veidiem/*.csv` |
| 2 | Student sign-up | None. Students never register or log in |
| 3 | Anonymity | Reviews are fully anonymous. No reviewer data is stored |
| 4 | Language | Latvian only |
| 5 | What is rated | Teachers only. An institution's score is calculated from the scores of its teachers |
| 6 | Review content | 1–5 score for each criterion, quick tags, a written comment, and the subject and period it covers |
| 7 | Teacher records | Admins add or bulk-import teachers. Students can also suggest a missing teacher, who appears only after approval |
| 8 | Teacher access | Teachers have no accounts. They can submit a public reply to a review, and it is published once an admin approves it |
| 9 | Moderation | Pre-moderation. Nothing is public until a moderator approves it |
| 10 | CMS roles | **Admin** (full access) and **Moderator** (moderation queues only) |
| 11 | Spam protection | Cloudflare Turnstile only. No IP addresses or fingerprints are stored |
| 12 | Moderator editing | Moderators may redact text. The review is then shown as "Moderatora labots" |
| 13 | Public teacher page | Average per criterion, tag counts, and all approved reviews with their text |
| 14 | Stack | Astro (SSR) on Cloudflare Workers, D1, Turnstile, Cloudflare Access for the CMS |
| 15 | GDPR | Teachers are listed under legitimate interest. There is a privacy policy and a removal/objection request process |
| – | Timeline | MVP in about 8 weeks |

---

## 2. Architecture

```
Browser ──► Cloudflare Worker (Astro SSR, @astrojs/cloudflare)
              ├── Public pages      /, /iestades/*, /pedagogi/*, ...
              ├── Public forms      review, teacher reply, removal request (Turnstile-protected)
              ├── Admin CMS         /admin/*  (behind Cloudflare Access)
              └── D1 binding  ──►   Cloudflare D1 (SQLite)
```

- **Astro SSR on Workers:** pages are rendered on the server, so search engines can index the institution and teacher pages. The public site and the CMS live in one project and one deploy.
- **D1:** accessed through the `DB` binding (`Astro.locals.runtime.env.DB`). Schema changes are managed with `wrangler d1 migrations`.
- **Turnstile:** a widget on every public form. Each token is verified on the server against `https://challenges.cloudflare.com/turnstile/v0/siteverify` before anything is written.
- **Cloudflare Access (Zero Trust, free for up to 50 users)** protects `/admin/*`, so no login system has to be built.
  - Admins log in with an email one-time PIN or Google.
  - The Worker validates the `Cf-Access-Jwt-Assertion` header and looks up the email in `admin_users` to find the role.
  - Unknown emails get a 403 response.
- **No outbound email in the MVP.** Moderators contact teachers and requesters from their own mailbox. A transactional email provider can be added later.

### Project layout

```
/
├── astro.config.mjs
├── wrangler.jsonc              # D1 binding, Turnstile secret, Access config
├── migrations/                 # D1 SQL migrations (0001_init.sql, ...)
├── scripts/
│   └── build-institutions-seed.py   # pa_veidiem/*.csv → seed SQL (upsert)
├── src/
│   ├── lib/
│   │   ├── db.ts               # query helpers
│   │   ├── scoring.ts          # aggregate recalculation
│   │   ├── turnstile.ts        # server-side token check
│   │   ├── auth.ts             # Access JWT validation + role lookup
│   │   ├── slug.ts             # Latvian-aware slugs + search normalisation
│   │   └── i18n/lv.ts          # all UI strings (Latvian)
│   ├── components/
│   ├── layouts/
│   └── pages/
│       ├── index.astro
│       ├── iestades/…          # public institution pages
│       ├── pedagogi/…          # public teacher pages + forms
│       ├── api/…               # form POST handlers
│       └── admin/…             # CMS
└── plan.md
```

---

## 3. Data model (D1)

```sql
-- Institutions (imported from the CSV export; reg_number is unique in the data)
CREATE TABLE institutions (
  id               INTEGER PRIMARY KEY,
  reg_number       TEXT NOT NULL UNIQUE,      -- "Reģistrācijas numurs"
  name             TEXT NOT NULL,             -- "Iestādes nosaukums"
  name_search      TEXT NOT NULL,             -- lowercase, diacritics stripped
  slug             TEXT NOT NULL UNIQUE,
  veids            TEXT NOT NULL,             -- 8 values (preschools excluded)
  tips             TEXT,                      -- 29 values
  founder          TEXT,                      -- "Dibinātājs"
  accredited       INTEGER NOT NULL DEFAULT 0,-- "Akreditēta"
  liquidated       INTEGER NOT NULL DEFAULT 0,-- "Likvidēta"
  subordination    TEXT,                      -- "Pakļautība"
  location         TEXT,                      -- "Atrašanās vieta" (115 values)
  hidden           INTEGER NOT NULL DEFAULT 0,
  -- cached aggregates
  avg_score        REAL,
  rated_teachers   INTEGER NOT NULL DEFAULT 0,
  review_count     INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_inst_veids    ON institutions(veids);
CREATE INDEX idx_inst_location ON institutions(location);
CREATE INDEX idx_inst_search   ON institutions(name_search);

-- Teachers
CREATE TABLE teachers (
  id           INTEGER PRIMARY KEY,
  full_name    TEXT NOT NULL,
  name_search  TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','active','hidden','removed')),
  source       TEXT NOT NULL CHECK (source IN ('admin','import','suggested')),
  avg_score    REAL,
  review_count INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_teacher_search ON teachers(name_search);

-- A teacher can work at several institutions
CREATE TABLE teacher_institutions (
  teacher_id     INTEGER NOT NULL REFERENCES teachers(id),
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  subjects       TEXT,                         -- free text, e.g. "Matemātika, Fizika"
  PRIMARY KEY (teacher_id, institution_id)
);

-- Rating criteria and tags (managed by admins in the CMS)
CREATE TABLE criteria (
  id          INTEGER PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE tags (
  id         INTEGER PRIMARY KEY,
  label      TEXT NOT NULL,
  sentiment  TEXT NOT NULL CHECK (sentiment IN ('positive','neutral','negative')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);

-- Reviews (no reviewer data stored)
CREATE TABLE reviews (
  id                  INTEGER PRIMARY KEY,
  teacher_id          INTEGER NOT NULL REFERENCES teachers(id),
  institution_id      INTEGER NOT NULL REFERENCES institutions(id),
  subject             TEXT,                   -- course/subject taken
  period              TEXT,                   -- e.g. "2025/2026"
  comment             TEXT NOT NULL,          -- published text (may be redacted)
  comment_original    TEXT,                   -- set only if a moderator edited it
  edited_by_moderator INTEGER NOT NULL DEFAULT 0,
  overall_score       REAL NOT NULL,          -- mean of criterion scores
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','removed')),
  rejection_reason    TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  moderated_at        TEXT,
  moderated_by        INTEGER REFERENCES admin_users(id)
);
CREATE INDEX idx_reviews_status  ON reviews(status, created_at);
CREATE INDEX idx_reviews_teacher ON reviews(teacher_id, status);

CREATE TABLE review_scores (
  review_id    INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  criterion_id INTEGER NOT NULL REFERENCES criteria(id),
  score        INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  PRIMARY KEY (review_id, criterion_id)
);
CREATE TABLE review_tags (
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (review_id, tag_id)
);

-- Teacher replies (published after admin approval)
CREATE TABLE teacher_replies (
  id            INTEGER PRIMARY KEY,
  review_id     INTEGER NOT NULL REFERENCES reviews(id),
  body          TEXT NOT NULL,
  contact_email TEXT,          -- for identity check; cleared after moderation
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  moderated_at  TEXT,
  moderated_by  INTEGER REFERENCES admin_users(id)
);

-- GDPR removal / objection requests
CREATE TABLE removal_requests (
  id              INTEGER PRIMARY KEY,
  requester_name  TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  relation        TEXT NOT NULL CHECK (relation IN ('teacher','institution','other')),
  target_type     TEXT NOT NULL CHECK (target_type IN ('teacher','review')),
  target_id       INTEGER NOT NULL,
  message         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','granted','partially_granted','denied')),
  resolution_note TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT,
  resolved_by     INTEGER REFERENCES admin_users(id)
);

-- CMS users (identity comes from Cloudflare Access)
CREATE TABLE admin_users (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT,
  role       TEXT NOT NULL CHECK (role IN ('admin','moderator')),
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Starting criteria (editable in the CMS)

1. **Skaidrība:** explains material clearly
2. **Taisnīgums:** fair and transparent grading
3. **Iesaiste:** makes lessons engaging
4. **Pieejamība:** available for questions and help
5. **Zināšanas:** subject knowledge

### Starting tags (editable in the CMS)

- **Positive:** Palīdzīgs, Interesantas stundas, Skaidras prasības, Grūts, bet vērtīgs
- **Neutral:** Daudz mājasdarbu, Stingra vērtēšana
- **Negative:** Neskaidras prasības, Bieži kavē

---

## 4. Institution import

- **Source:** `pa_veidiem/*.csv` (`;`-separated, UTF-8 with BOM).
  - The original `iestades_export.csv` was split into these files and is no longer in the repo.
- **Preschools are excluded.** The script skips every row where `Veids = "Pirmsskolas izglītības iestāde"` (576 institutions). This also applies when a newer full export is re-imported. The file `Pirmsskolas izglītības iestāde.csv` stays in `pa_veidiem/`, but nothing is imported from it.
- **Script:** `scripts/build-institutions-seed.py` reads every file and writes `seed/institutions.sql`.
  - Each row becomes an `INSERT … ON CONFLICT(reg_number) DO UPDATE`, so a newer export can be re-imported without creating duplicates.
- **Mapping:** `Jā`/`Nē` become 1/0. `Pakļautība` is trimmed, because it contains trailing spaces.
- **Generated fields:** `slug` (Latvian characters transliterated, with a suffix if two names collide) and `name_search`.
- **Liquidated institutions:** if a later export marks an institution `Likvidēta = Jā`, it stays on the site with a "likvidēta" badge, so its existing reviews remain visible.
- **Run:** `wrangler d1 execute <db> --remote --file seed/institutions.sql`

### Teacher bulk import (CMS)

- An admin uploads a CSV with the columns `full_name;institution_reg_number;subjects`.
- The CMS shows a preview before anything is imported. It flags:
  - teachers that may be duplicates (same normalised name at the same institution)
  - registration numbers it doesn't recognise
- After the admin confirms, the teachers are created with `status = 'active'` and `source = 'import'`.

---

## 5. Public site (Latvian UI)

| Route | Content |
|---|---|
| `/` | Search box (institutions and teachers), browse by type, recently approved reviews, totals |
| `/iestades` | Institution list with filters by **Veids**, **Tips** and **Atrašanās vieta**, plus sorting by score |
| `/iestades/[slug]` | Institution details, combined score, number of rated teachers, list of teachers with scores, "Pievienot pedagogu" link |
| `/pedagogi/[slug]` | Teacher page with the items listed below |
| `/pedagogi/[slug]/vertet` | Review form for this teacher |
| `/vertet` | Review form that starts by choosing the institution, then the teacher (or suggesting a new one) |
| `/atbildet/[reviewId]` | Teacher reply form |
| `/noteikumi` | Review rules: what is and isn't allowed |
| `/privatuma-politika` | Privacy policy (GDPR) |
| `/dzesanas-pieprasijums` | Removal/objection request form |

The teacher page (`/pedagogi/[slug]`) shows:
- the teacher's name and institutions
- the overall average and the average for each criterion
- tag counts
- approved reviews with filters (institution, period) and newest first
- approved teacher replies under the review they answer
- the "Moderatora labots" marker on edited reviews

**Search.** SQLite has no Latvian collation, so search uses a normalised copy of each name:
- Both the stored `name_search` column and the user's query are lowercased, and diacritics are removed (ā→a, č→c, ķ→k, …).
- Matching uses `LIKE '%query%'`, which is fast enough for about 2,000 institutions and a few thousand teachers.
- If the number of teachers grows a lot, switch to FTS5.

**SEO.**
- Each page gets its own `<title>` and meta description.
- Teacher and institution pages include `schema.org` markup.
- `sitemap.xml` is generated from D1.
- Pending and hidden teachers are never rendered.

---

## 6. Review submission flow

1. The student opens a teacher's page and clicks **Novērtēt**. Alternatively, they use `/vertet` and choose the institution, then the teacher.
   - If the teacher is missing, the student can suggest one by entering a name and subject. This creates a teacher with `status = 'pending'` and `source = 'suggested'`.
2. The form asks for:
   - a 1–5 score for every active criterion (required)
   - tags (optional, up to 5)
   - subject and period (optional)
   - a comment (required, 30–2,000 characters)
   - a checkbox confirming they accept `/noteikumi`
3. The Turnstile token is verified on the server, and all input is validated against the D1 lists of active criteria and tags.
4. The review, its scores and its tags are inserted with `status = 'pending'` in one `DB.batch()`. `overall_score` is the mean of the criterion scores.
5. The confirmation page reads: "Paldies! Atsauksme tiks publicēta pēc moderatora pārbaudes."

The form shows a privacy hint next to the comment field: don't write your own name, other students' names, or contact details.

**Not stored:** IP address, user agent, cookies or any other reviewer identifier.

---

## 7. Admin CMS (`/admin`)

### Roles

| Capability | Moderator | Admin |
|---|:-:|:-:|
| Review queue: approve, reject with reason, redact | ✓ | ✓ |
| Approve or reject suggested teachers | ✓ | ✓ |
| Teacher reply queue | ✓ | ✓ |
| Remove a published review | ✓ | ✓ |
| Removal (GDPR) requests | – | ✓ |
| Add, edit, hide or merge teachers; bulk import | – | ✓ |
| Edit or hide institutions; re-import the CSV | – | ✓ |
| Manage criteria and tags | – | ✓ |
| Manage CMS users and roles | – | ✓ |

### Screens

- **Dashboard:** counts for each queue (pending reviews, suggested teachers, replies, open removal requests) and the oldest pending item.
- **Review queue:**
  - Shows one review at a time with its teacher, institution, scores, tags and comment.
  - Actions: **Apstiprināt**, **Labot un apstiprināt**, **Noraidīt** (with a reason picked from a list or written in).
  - Keyboard shortcuts for fast moderation.
  - If the teacher is still pending, approving the review asks the moderator to approve the teacher first.
- **Editing (redaction):**
  - The first edit copies the original text to `comment_original` and sets `edited_by_moderator = 1`.
  - The public page shows "Moderatora labots".
  - The original text is visible only in the CMS.
- **Teachers:**
  - list and search
  - edit name and institutions
  - **merge duplicates** (moves the reviews to the remaining record and keeps the old slug as a redirect)
  - hide
  - bulk import
- **Institutions:** search, edit, hide, and a page to re-import the CSV.
- **Teacher replies:**
  - Each reply is shown with the review it answers.
  - The moderator checks that the sender really is the teacher, for example through an institution email address or by contacting them through official channels.
  - On approval or rejection, `contact_email` is cleared.
- **Removal requests:** the request, a link to its target, the resolution choices and a resolution note.
- **Criteria and tags:** add, rename, reorder, deactivate.
  - Criteria and tags are never deleted once used, so old reviews stay consistent.
- **CMS users:** add an email with a role, or deactivate a user.
  - The email must also be allowed in the Cloudflare Access policy.

### Moderation guidelines (to be published as `/noteikumi`)

Reject or redact a review when it contains any of the following:
- insults, threats or discrimination
- claims about private life or health
- unverifiable accusations of crimes
- names of students or other third parties
- contact details
- spam
- content unrelated to teaching

Do not reject a review only because it is negative.

---

## 8. Scoring

- **Review score:** mean of that review's criterion scores (1–5).
- **Teacher score:** mean of `overall_score` over approved reviews. Per-criterion averages come from `review_scores` joined with approved reviews.
- **Institution score:** mean of the teacher averages calculated from reviews submitted *for that institution*. Each teacher counts equally, so one teacher with many reviews doesn't dominate.
  - The page also shows how many teachers are rated, which tells the reader how reliable the score is.
- **Caching:** `scoring.ts` recalculates the cached `avg_score` and `review_count` for the affected teacher and institution(s) whenever a review is approved, rejected after approval, removed, merged or reassigned. The updates run in the same `DB.batch()` as the status change.
  - An admin action "Pārrēķināt visu" rebuilds every aggregate.
- **Display:** scores are shown to one decimal place, together with the review count.

---

## 9. GDPR and legal

- **Legal basis:** legitimate interest (Art. 6(1)(f)): students' right to share and receive information about the quality of education.
  - Write a short legitimate-interest assessment and keep it in the repo docs.
- **Data minimisation:**
  - Nothing that identifies a reviewer is stored.
  - Teacher data is limited to name, institution and subjects.
  - Teacher reply contact emails are deleted after moderation.
  - Removal request data is kept for 12 months after resolution, then deleted by a scheduled Worker (Cron Trigger).
- **Privacy policy** (`/privatuma-politika`) must state:
  - the data controller and their contact details
  - what data is processed and why
  - the legal basis
  - how long data is kept
  - the rights to access, object and erase
  - the right to complain to the Data State Inspectorate (Datu valsts inspekcija)
- **Removal/objection process:**
  - The form at `/dzesanas-pieprasijums` lands in the admin queue.
  - Aim to respond within 30 days, which is the GDPR maximum.
  - Possible outcomes: hide the teacher, remove specific reviews, redact text, or deny with a stated reason.
- **Before launch:** get a legal review of the rules, the privacy policy and the legitimate-interest assessment, with a focus on defamation risk in free-text reviews.

---

## 10. Security

- **Admin access:** `/admin/*` is protected by Cloudflare Access, and the Worker also validates the Access JWT (signature, audience and expiry) and checks the user's role on every admin request and API call.
- **Spam:** every public POST requires a valid Turnstile token.
- **Escaping:** all user text is rendered as escaped plain text (no HTML or Markdown), with line breaks preserved.
- **Queries:** parameterised D1 queries only (`prepare().bind()`).
- **CSRF:** a same-origin check on admin POST requests.
- **Headers:** a strict Content Security Policy that allows only Turnstile scripts and frames.
- **Size limits:** server-side length limits on every field.
- **Backups:** D1 Time Travel gives point-in-time restore for the last 30 days. In addition, a weekly `wrangler d1 export` dump is kept outside Cloudflare.

---

## 11. Milestones (8 weeks)

| Week | Deliverable |
|---|---|
| 1 | Astro project with the Cloudflare adapter, D1 database, migration `0001_init`, institution seed script and import, Cloudflare Access and `admin_users`, staging and production environments |
| 2 | Public institution list (filters, search) and institution pages, Latvian slugs and normalisation, base layout and design |
| 3 | Teacher pages (read-only), admin teacher management (add, edit, hide), teacher bulk import |
| 4 | Review form, Turnstile, validation, submission with `pending` status, teacher suggestion |
| 5 | CMS review queue (approve, reject, redact), suggested-teacher approval, scoring and aggregate caching |
| 6 | Teacher reply flow, removal request form and queue, criteria and tag management, teacher merge |
| 7 | `/noteikumi` and `/privatuma-politika` content, SEO (meta, sitemap, schema.org), accessibility, mobile layout, tests (scoring, validation, auth) |
| 8 | Legal review, test data cleanup, moderator onboarding, production deploy, launch |

### MVP acceptance criteria

- All 1,443 institutions in scope can be browsed and searched, and no preschools appear.
- A student can submit a review without an account, and it stays hidden until it is approved.
- A moderator can approve, reject or redact a review, and approved reviews update the teacher and institution scores.
- An admin can add or import teachers and manage criteria, tags and CMS users.
- Teacher replies and removal requests can be submitted and handled in the CMS.
- No reviewer-identifying data is present in D1.

---

## 12. Risks and open items

- **Turnstile only blocks bots.** A person can still flood the moderation queue by hand.
  - If that happens, add a Cloudflare WAF rate-limiting rule on the submit endpoint. It works at the edge, so nothing is stored in D1.
- **Moderator workload:** with 1,443 institutions in scope, the queue could grow quickly. Track the age of pending items on the dashboard and recruit moderators to match.
- **Fake or biased reviews:** without accounts, the only defences are pre-moderation and the rules. Showing review counts next to scores helps readers judge how reliable a score is.
- **Duplicate teachers:** students may suggest teachers who already exist, or spell names differently. The suggestion form shows matching names first, and the CMS has a merge tool.
- **Verifying teacher identity for replies:** the check is manual in the MVP. An email confirmation link could be added later with a transactional email provider.
- **Defamation:** free-text reviews carry legal risk. The mitigations are moderation guidelines, redaction and a legal review before launch.
- **Minors:** many schools in the dataset (general schools, interest education) have underage students. Since no personal data is collected from reviewers, risk is low. Still, the rules should be written in age-appropriate language, and the legal review should confirm the approach.

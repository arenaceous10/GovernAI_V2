# GovernAI

Responsible AI governance, from intake to retirement. Clients register their AI products; the governance team reviews
evidence and signs off each of the ten lifecycle stages. Every submission and decision goes into a tamper-evident record
that anyone can check, and the same data produces EU AI Act and DPDP documentation drafts.

Indicative assessment, not legal advice.

## Contents

- [Run it](#run-it)
- [Configuration](#configuration)
- [Database (Supabase)](#database-supabase)
- [Deploy on Vercel](#deploy-on-vercel)
- [Roles and sign-in](#roles-and-sign-in)
- [How a product moves through GovernAI](#how-a-product-moves-through-governai)
- [Features](#features)
- [Security and privacy](#security-and-privacy)
- [Running it in production](#running-it-in-production)
- [Tests](#tests)
- [Layout](#layout)

## Run it

```bash
npm install          # once, needs internet
npm run dev          # http://localhost:5173
npm test             # unit tests (engine, store sync, features, AI guard, record and packs, operations, documents)
npm run test:db      # database rules and triggers, on an in-process Postgres (PGlite)
npm run test:fuzz    # about 200,000 generated cases across the engine, store, server code and database (SCALE=0.2 for a quick pass)
npm run build        # production build in dist/
npm run build:single # one self-contained dist-single/index.html (double-click to open)
```

Without database settings the app runs on **demo data in the browser**: a portfolio of 8 products across 3 clients, a
role switcher instead of sign-in, and the sidebar says "Demo data in this browser". Administrator > Settings > Reset to
demo data restores it. Signed evidence packs and the model-registry connection need the server and are off in demo mode.

## Configuration

Copy `.env.example` to `.env.local` for local runs. On Vercel add the same names under Settings > Environment Variables.

| Name | Where | What it does |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | browser and server | Supabase project and its publishable key. Leave empty for demo mode. Never use the service-role key. |
| `GEMINI_API_KEY` | server only | Tailored assessment questions written by Gemini (`api/generate-questions.js`). Without it the built-in rules pick them. Never prefix with `VITE_`. |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` | server only | Optional model choice and comma-separated fallbacks. |
| `EVIDENCE_SIGNING_KEY` | server only | Ed25519 private key (PKCS#8 DER, base64) that signs evidence packs. Its public half must match `src/data/evidenceKey.js`. |
| `CONNECTOR_KEY` | server only | 32 random bytes, base64. Encrypts model-registry tokens. Changing it means clients reconnect their registries. |

Generate the two keys once:

```bash
node -e "const c=require('crypto');const {publicKey,privateKey}=c.generateKeyPairSync('ed25519');
console.log('EVIDENCE_SIGNING_KEY='+privateKey.export({format:'der',type:'pkcs8'}).toString('base64'));
console.log('public key for src/data/evidenceKey.js: '+publicKey.export({format:'der',type:'spki'}).toString('base64'));
console.log('CONNECTOR_KEY='+c.randomBytes(32).toString('base64'))"
```

If you replace the signing key, update `src/data/evidenceKey.js` in the same deploy. Packs signed with the old key then
show "Signature does not match", so keep the old public key somewhere if older packs must stay checkable.

## Database (Supabase)

Run the migrations in order in the Supabase SQL editor (or with the Supabase CLI). All tables are prefixed `v2_` and sit
beside any other tables in the project; the older tables (`use_cases`, `checklist`, `approvals`, `audit`, `incidents`,
`changes`, `screenings`, `actions`) are not touched.

| Migration | What it adds |
|---|---|
| `001_governai_v2.sql` | Products (one JSON document per product), clients, settings, audit log. |
| `002_evidence_files.sql` | Private Storage bucket `v2-evidence`: files up to 10 MB, opened through links that expire after 10 minutes. |
| `003_auth_rbac.sql` | Sign-in profiles, roles and row-level security: clients see only their organisation; internal notes are in a separate table clients cannot read. |
| `004_ai_usage.sql` | Usage counter for the AI question endpoint. |
| `005_security_fixes.sql` | Product write rules enforced by a trigger (see [Security](#security-and-privacy)), server-stamped audit entries, atomic AI rate limits, new accounts start as pending. |
| `006_function_privileges.sql` | Tighter execute rights and search paths on the database functions. |
| `007_ledger_and_ops.sql` | Tamper-evident record (`v2_ledger`) written by triggers, and client branding. Existing products get a starting entry. |
| `008_withdrawal_guard.sql` | Clients may request or cancel a withdrawal; only the governance team decides, and withdrawn products are frozen for clients. |
| `009_test_sweep_fixes.sql` | A live product unblocked by a re-assessment returns to production; retired products are frozen for clients; closed stage rounds are not recorded as removals; repeated identical log entries are each recorded. |
| `010_product_versions.sql` | A version number on each product: a save made over someone else's newer save is refused instead of overwriting it. |
| `011_operations.sql` | Error reports from people's screens (administrators read them), the `gov_health()` check, and the per-organisation AI switch. |
| `012_approved_versions_guard.sql` | Only the governance team may write `approvedVersions` (the model versions a go-live or change approval covers). Optional hardening: the app works without it. |

Saving: every change is saved as it happens. A failure shows "Not saved" with Retry in the sidebar. Other people's changes
appear when the tab regains focus. In Supabase Auth settings, keep email confirmation on and turn on leaked-password protection.

## Deploy on Vercel

Import the repo (framework: Vite) and set the variables above. `vercel.json` adds the security headers (content security
policy, no framing, no MIME sniffing, strict referrer and permissions policies). The server functions are:

| Function | Purpose |
|---|---|
| `api/generate-questions.js` | Tailored questions from Gemini, for signed-in users, rate-limited, with personal data removed first. |
| `api/evidence.js` | `GET`: the public key that checks evidence packs. `POST`: a signed pack for one product the caller may see. |
| `api/connector.js` | Seals a registry token, tests a registry connection, reads model versions and metrics. |
| `api/health.js` | Public `GET`: is the database answering, and which server features are set up (true or false only). Called daily by the Vercel cron in `vercel.json`. |

Every function checks the caller's Supabase session and reads with that person's own token, so row-level security limits
what it can see.

## Roles and sign-in

People create their own account. Every new account waits until an administrator approves it, including someone who
creates a new organisation at sign-up (the admin list flags those). Disabled accounts lose access at once.

| Role | Home screen | Does |
|---|---|---|
| Client | Next steps, products by lifecycle phase, charts | Registers and re-assesses products, ticks checklists, skips optional checks with a reason, attaches evidence, submits stages, manages actions, controls, data assets and the AI card, connects a model registry, raises changes, incidents and retirement. Sees only its own organisation. |
| Governance reviewer | Review queue, pipeline board | Approves, approves with conditions or returns submitted stages, with a comment and an optional internal note. Sees Operations. |
| Governance lead | Gate decisions, risk-by-phase matrix | Also signs stages 2, 5, 6 and every change (stage 8) for high-risk products, can sign in a reviewer's place, can override a gate with a reason, raises production events. |
| Administrator | Setup shortcuts, recent activity | Approves accounts; manages clients (including logo and colour), users, question bank, frameworks, tier cut-offs, mandatory checks, review target; reads the audit log. |

Permissions are enforced in the database, not only in the app.

## How a product moves through GovernAI

1. **Register** (4 steps, about 3 minutes): product details, frameworks in scope, risk profile (12 questions and the
   regulatory screening), review. Every question offers "Not known"; each such answer becomes an action to find out.
   The tier shown is **provisional**: it rests on the risk profile alone, and controls can only bring it down.
   The control questions (including the AI-tailored ones) are written in the background as soon as the product is
   registered, so stage 2 opens without a wait. Serverless functions run in Singapore, next to the database (`vercel.json`).
2. **Control assessment** (stage 2): the control questions are answered once, with evidence, on their own page.
   "Evidenced" needs a file or a link. "In place" needs a reference (where it is documented or who owns it), and a file
   or link when the control is critical and the risk profile alone puts the product at High. Stage 2 cannot be
   submitted until every question is answered and backed. The governance team can lower a rating with a reason (never
   raise it); both ratings are kept and the score uses the lower. Approving stage 2 confirms the controls and makes the
   tier final. Products registered before this change keep their self-declared answers and the full re-assessment.
3. **Score**: based on the six Responsible AI principles (Social well-being and planet inclusive 14, Privacy and safety 20,
   Fairness and equity 20, Robustness and stability 16, Accountability 16, Transparency 14). About 75% standard questions per
   framework and 25% tailored to the product; four options per question scored 0 / 35 / 70 / 100.
4. **Tier**: the EU AI Act's four tiers, on one cut-off scale for every product: **Limited from 40, High from 65**
   (editable in Settings). Scoring version 2:
   - a principle's risk is 40% its worst item and 60% the average of its items, so one serious exposure is not
     averaged away; when an output can decide access to something essential or a failure can cause serious harm, no
     principle is rated below Medium (the stakes floor);
   - the type of AI is rated by how it is used (one step lower when a person makes every decision, one step higher
     when outputs take effect without review; agents and biometric identification stay at the top rating);
   - controls lower a principle's risk by up to 35%, principle by principle, and never while one of that principle's
     critical controls is not yet in place;
   - control credit is suspended while an incident is open, a high-priority action is overdue, or a model version in
     the connected registry has not been approved.

   Prohibited practices are always Unacceptable. With the EU AI Act in scope, Annex III uses are at least High
   (unless the Art. 6(3) exception applies), Annex I products and safety components are High, and Art. 50 uses are at
   least Limited. GDPR and the DPDP Act set no tier: their position (DPIA, Art. 22, Significant Data Fiduciary check,
   children's data) is shown law by law beside the result.

   Every assessment records the scoring version it was made with (`assessment.scoring`) and is always re-scored with
   it. Assessments made before version 2 keep the earlier method (plain averages, one overall control credit and
   cut-offs by law: EU AI Act 30/55, GDPR 35/60, DPDP Act 40/65, none 35/60) until they are re-assessed.
5. **Lifecycle**: ten stages, each with a checklist, required evidence and an exit gate. Checks are **mandatory** or
   **optional**; an optional check can be skipped with the "Skip with reason" button on its row (category, written
   reason, target date for planned work). Submit for review unlocks when mandatory checks are ticked and every optional
   one is ticked or skipped. The governance team approves or returns; approval moves the product on. After go-live it
   stays in stage 7; a change opens stage 8 and an incident stage 9 (both return to 7); stage 10 retires it.

## Features

**For everyone**
- **Deadline radar**: EU AI Act and DPDP dates that apply to each product, with a countdown (`src/data/deadlines.js`).
- **Notifications**: decisions on your products, submissions and overdue reviews for the governance team, pending sign-ups for administrators.
- **Quick search**: Ctrl K or Cmd K jumps to any product or page.

**Products**
- **Controls and actions**: 22 controls mapped to checklist items, each shown as operating, in progress or gap; actions come from skipped checks, "Not known" answers, reviewers and clients.
- **AI cards**: a register of every AI product, like a business glossary entry for a data asset: purpose, owners, data, limitations, oversight, metrics, versions.
- **Data and lineage**: datasets with owners, stewards, classification and a lineage graph.
- **Dashboard charts** for clients: products by stage, risk and answers.

**Withdrawing and deleting products**
- **Drafts**: the client deletes them from the products list.
- **Registered, never in production**: the client asks to withdraw with a reason (project cancelled, duplicate, registered by mistake, replaced by another product, not an AI system, other). A governance lead or administrator approves or refuses with a note. A withdrawn product leaves every list, chart and count, stays readable under "Show withdrawn products", and is read-only. An administrator can restore it.
- **In production**: no withdrawal; retire it through stage 10 (retirement).
- **Permanent deletion**: administrators only, for withdrawn or retired products, after a retention period (Settings, default 30 days), confirmed by typing the product code. Evidence files and internal notes are deleted too; the tamper-evident record keeps the deletion and everything before it.

**Proof and documents**
- **Tamper-evident record** (Record tab): the database writes an entry for every registration, stage and status move,
  submission (with a fingerprint of the checks, skips and evidence file names submitted), decision, edit of an earlier
  entry and deletion. Each entry is hashed together with the one before it (SHA-256), so changing or removing any entry
  breaks the chain from there on. Nobody can write to the record through the API. The tab re-checks the chain in the
  browser and compares it with what the product shows.
- **Signed evidence packs**: a download holding the product, its full record and an Ed25519 signature. Anyone can check
  one on the public "Check an evidence pack" page (`#verify`, no account needed); signed-in users also see whether the
  live record still matches. Keep packs as receipts: if history were rewritten later, the pack would no longer match.
- **Report menu**:
  - Dashboard deck (PowerPoint, with SWOT and the AI Compass).
  - Full audit report (HTML).
  - **Annex IV technical documentation** (Word draft): the nine Annex IV sections, filled from the product, gaps marked with what to add.
  - **DPDP pack** (Word draft): processing record and privacy notice draft. Tick the option to add the Significant Data Fiduciary part (impact assessment, audit, algorithmic due diligence).

  Documents are filled from stored data only, never by a language model, and include the client's logo when set.

**Integrations (Databricks)**

The model registry opens at stage 4, Design and development, when the model is being built. Before that the AI card says so, and the app, the store and `api/connector.js` all refuse to connect, test or read a registry (`src/lib/registryStage.js`).

All four use the product's single model-registry connection (address and a sealed read-only token):
- **Model registry** (AI card): MLflow or Databricks Unity Catalog. Versions, run metrics, description and owner
  appear on the card ("Fill from registry" fills empty card fields). A new version of a product in production opens a
  change review. Checked when the card opens (if not checked in the last 12 hours), with "Check now", or for every
  product from Operations; there is no background schedule because that would need a service-role key.
- **Evaluations and traces** (AI card): MLflow GenAI evaluation runs (runs whose metrics are aggregates such as
  `correctness/mean`) and a summary of recent traces (count, errors, last call, median time) from the model's
  experiment, or an experiment you name. Shown in the Annex IV draft under validation.
- **Production monitoring** (AI card): a Databricks data profiling monitor (formerly Lakehouse Monitoring) on a table
  you name, usually the inference table. Monitor status; with a SQL warehouse ID also drifted columns in the latest
  window (Jensen-Shannon distance > 0.1, population stability index > 0.2 or Kolmogorov-Smirnov p < 0.05) and live
  performance. New drift is recorded once as an alert and in the audit log and tamper-evident record. Shown in the
  Annex IV draft under post-market monitoring.
- **Unity Catalog tables** (Data and lineage tab): owner, description, columns, upstream and downstream tables and
  monitoring status per table. Lineage comes from `system.access.table_lineage` when a SQL warehouse ID is set,
  otherwise from Databricks' lineage endpoint, which is not in its public API reference. Use, classification, personal
  data and steward stay as people set them.

SQL statements run on the client's SQL warehouse (their compute). Table names go in as parameters or quoted
identifiers, never pasted into SQL text.

**For the governance team**
- **Operations**:
  - Review timers against a working-day target (default 5, set in Settings).
  - Reviewer workload: decisions and median turnaround.
  - A portfolio row per client.
  - **Time to value**: days from a client's start to its first approved stage, with the median across clients.
- **Client branding**: an administrator sets each client's logo and accent colour, shown in its portal and documents.

## Security and privacy

- **Row-level security**: clients read and write only their organisation's products, files and records.
- **Product rules in the database**: a trigger checks every product write. Clients cannot approve stages, change review dates, skip stages, edit submitted or approved stages, rewrite the stage log, or pose as another product or organisation.
- **Audit entries** from clients are stamped by the server with the real time, role, name and organisation.
- **AI endpoint**:
  - Only for signed-in users, with per-user hourly and daily limits and a global daily limit, counted atomically.
  - Requests limited to 24 KB.
  - **No sensitive data to the language model**: names, emails, phone numbers, identifiers, account numbers and the client's own names are removed before anything is sent (`src/lib/redact.js`).
- **Registry tokens** are encrypted with AES-256-GCM on the server and tied to one product. The connector only calls public https addresses (checked after DNS lookup), follows no redirects and caps time and size.
- **Exports**: reports escape all values, and CSV exports neutralise spreadsheet formulas.
- **Files** open only from safe link types.

## Running it in production

**Two people on the same product.** Each product carries a version number. A save must start from the version the
screen loaded; if a colleague saved first, the save is refused, the screen loads the colleague's version and says so,
and the person makes the change again. Screens also pick up other people's changes every minute and when the tab
comes back into focus, so collisions are rare.

**Large portfolios.** Tables show 100 rows at a time with "Show more"; dashboards show the first items of each list;
the audit log loads the newest 800 entries and older ones on request. Whole tables are read in pages, so nothing is
cut off at the database's 1,000-row limit. Measured with `N=1500 node tests/e2e/scale.cjs` (local, no network):
1,500 products and 20,000 audit entries sign in in about 3 seconds for an administrator and every page opens in under
half a second. Product data is about 34 KB each before compression (about 6 MB compressed for 1,000 products), so
sign-in time on a real connection grows with portfolio size.

**System health** (Settings, administrators, signed-in mode): whether the server and database answer, which server
features are set up, the last 50 errors from people's screens (personal details scrubbed, at most 30 an hour per
person, kept 60 days), and a full backup download.

**Keep-alive and monitoring.** `vercel.json` calls `/api/health` once a day, which keeps a free Supabase project from
pausing after a week without activity. Point a free uptime monitor (for example UptimeRobot) at `/api/health` too: it
answers 200 when the database is up and 503 when it is not.

**Backups.** Settings > System health > Download a full backup gives one JSON file with everything an administrator
can read. To put missing rows back: `node scripts/backup-to-sql.mjs backup.json > restore.sql`, then run `restore.sql`
in the Supabase SQL editor. Existing rows are left alone, running it twice changes nothing, and the tamper-evident
record is restored row for row, so it still verifies. Evidence files live in Supabase Storage and are not in the JSON;
download them from the Storage page if you need a copy.

**AI per organisation.** In Clients and users, the "AI on / AI off" button per organisation. Off means that
organisation's descriptions are never sent to the AI service (the server refuses too); its questions come from the
rules engine.

**Load test.** `node scripts/load-test.mjs https://your-site 300 20` reads the app page and `/api/health` 300 times,
20 at once, and reports median, 95th percentile and failures. It never signs in or writes.

**Free steps outside the app**

1. Supabase, Authentication, Attack Protection: turn on leaked password protection.
2. Supabase, Authentication, Emails, SMTP settings: connect a free email service (Resend, Brevo and others have free
   tiers). The built-in sender only allows a few emails an hour, which sign-ups and password resets soon exceed.
3. A free uptime monitor on `/api/health`.
4. A weekly backup download.

**Paid items that remain** (not done here): Vercel Pro for commercial use, a paid Supabase plan (point-in-time
backups, no pausing, higher limits), a paid Gemini tier (inputs not used for training), single sign-on, an external
penetration test, a legal review of the regulatory content.

## Tests

The fuzz suites (`tests/fuzz`) generate random products, answers, people and requests and check rules that must
always hold: scores stay in range and never improve when controls get worse; a client never changes another
organisation's product, an archived product or a decision; nothing recorded is lost when a stage starts again; the
record always verifies; private network addresses are refused in every spelling; registry answers of any shape give
a plain error, never a crash.

```bash
npm test && npm run test:db && npm run test:fuzz

npx playwright install chromium            # once
# Browser-only demo build:
npm run build && node tests/e2e/serve-with-headers.cjs dist 4173 &
node tests/e2e/lifecycle.cjs               # landing, registration, all 10 stages, returns, override, incident, retirement
node tests/e2e/drafts-reassess-mobile.cjs  # drafts, re-assessment, mobile layout
node tests/e2e/features.cjs                # Not known, skips with reasons, controls, actions, AI cards, deck
node tests/e2e/governance.cjs              # legal position, EU role and Annex I, incident clocks, suspended credit, registry panel
node tests/e2e/contrast.cjs                # text contrast on every page
node tests/e2e/random-clicks.cjs 7 3       # random clicks and typing (hostile text too) on every page for every role

# Cloud build against the in-memory Supabase stand-in (tests/e2e/fake-supabase.cjs), signed with a test key:
VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=test \
VITE_EVIDENCE_PUBLIC_KEY=$(node -e "console.log(require('./tests/e2e/test-evidence-key.cjs').pub)") \
  npx vite build --outDir dist-cloud
node tests/e2e/serve-with-headers.cjs dist-cloud 4174 &
node tests/e2e/auth.cjs                    # sign-up, approval, sign-in, role-based access
node tests/e2e/cloud.cjs
node tests/e2e/evidence.cjs                # upload, open as reviewer, replace, remove evidence files
node tests/e2e/bugs.cjs                    # double-click approve, access turned off, search, notifications
node tests/e2e/questions.cjs               # admin adds questions, client sees them
node tests/e2e/concurrency.cjs             # two people saving the same product
node tests/e2e/operations.cjs              # system health, error reports, backup, older audit entries, AI per organisation
N=1000 node tests/e2e/scale.cjs            # timings with a large portfolio
node tests/e2e/clients.cjs                 # client administration
node tests/e2e/proof.cjs                   # record, signed packs, public check, Word drafts, registry, operations, branding
node tests/e2e/withdraw.cjs                # withdrawal request, decision, archive, restore, permanent deletion
```

`serve-with-headers.cjs` serves a build with the same security headers as `vercel.json`.

## Layout

```
api/                        Vercel functions: generate-questions, evidence, connector
src/data/                   lifecycle.js (stages), frameworks.js, questionBank.js, controls.js, card.js,
                            deadlines.js, countries.js, evidenceKey.js (public key for packs)
src/engine/                 engine.js (scoring, tiers, questions), insights.js, report.js, deck.js,
                            docpack.js (Annex IV and DPDP), ops.js (timers, workload, time to value)
src/lib/                    cloud.js, files.js, redact.js, aiGuard.js, ledger.js (record and pack checks),
                            api.js, serverAuth.js, server/ (evidence signing, registry connector)
src/store/                  store.jsx (state and permissions), sync.js (Supabase reads and writes), seed.js (demo data)
src/pages/                  Landing, Auth, Dashboard, Products, Product, NewAssessment, AICard, Catalog, Ops, Admin, Other
src/components/             ui, Stages, Results, Insights, DataAssets, LineageGraph, Proof (record and check page),
                            Registry (model registry), Extras (notifications, search, toasts)
supabase/migrations/        SQL, run in order
tests/                      unit tests, db/ (PGlite), e2e/ (Playwright)
```

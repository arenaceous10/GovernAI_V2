# GovernAI

Responsible AI governance, from intake to retirement. Clients register AI products; the governance team
reviews evidence and signs off each of the ten lifecycle stages from the Responsible AI charter.

## Run it

```bash
npm install          # once, needs internet
npm run dev          # http://localhost:5173
npm test             # engine and database-layer tests
npm run build        # production build in dist/
npm run build:single # one self-contained dist-single/index.html (double-click to open)
```

## Database (Supabase)

With `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set (see `.env.example`), every change is saved to Supabase and shared
between browsers. Without them the app runs on browser-only demo data (sidebar shows which). On first run it seeds a demo
portfolio of 8 products across 3 clients. Administrator > Settings > Reset to demo data restores it.

- Tables are prefixed `v2_` (`supabase/migrations/001_governai_v2.sql`) and sit beside any other tables in the project.
- **Demo access only:** there is no login yet, so row-level security lets the browser key read and write these tables.
  Keep sample data only until sign-in is added, then replace the `demo open access` policies with per-user rules.
- Evidence files go to the private Storage bucket `v2-evidence` (`supabase/migrations/002_evidence_files.sql`), up to 10 MB
  each, and open through a link that expires after 10 minutes. Replacing or removing evidence deletes the old file.
  Browser-only mode keeps files up to 2 MB in the browser instead.
- A save failure shows "Not saved" with a Retry button in the sidebar. Other people's changes appear when the tab regains focus.

## Deploy on Vercel

Import the repo (framework: Vite). Optional: set `GEMINI_API_KEY` (and `GEMINI_MODEL`) so the tailored questions are
written by Gemini through `api/generate-questions.js`. Without it, the built-in rules engine picks them.

## Roles

| Role | Sees | Does |
|---|---|---|
| Client | Their organisation's products: scores, tiers, lifecycle stage | Registers products, completes stage checklists, attaches evidence, submits stages |
| Governance reviewer | All clients | Reviews stages: approve, approve with conditions, or return |
| Governance lead | All clients | Also signs stages 2, 5 and 6 for High-risk products; can override a gate with a reason |
| Administrator | All clients (read-only) | Clients and users, question bank wording, frameworks, tier cut-offs, audit log |

## Flow

1. **Register** (5 steps): product details (dropdowns for domain, 21 AI types, sourcing; searchable list of every country),
   frameworks, risk profile, questionnaire, review.
2. **Score**: common to every framework, based on the six Responsible AI principles
   (Social well-being and planet inclusive 14, Privacy and safety 20, Fairness and equity 20, Robustness and stability 16,
   Accountability 16, Transparency 14).
3. **Tier**: EU AI Act four tiers. Cut-offs depend on the frameworks in scope; the strictest wins.

   | Framework | Limited from | High from |
   |---|---|---|
   | EU AI Act | 30 | 55 |
   | GDPR | 35 | 60 |
   | DPDP Act | 40 | 65 |
   | None | 35 | 60 |

   Prohibited practices are always Unacceptable. With the EU AI Act in scope, Annex III uses are at least High and
   Art. 50 uses at least Limited. Cut-offs are editable in Settings.
4. **Lifecycle**: the product starts at stage 1. Each stage has the charter's checklist, required evidence and exit gate.
   The client ticks the checklist, attaches evidence and submits; the governance team approves or returns. Approval moves
   it to the next stage. After go-live it stays in stage 7; a change opens stage 8 and an incident stage 9 (both return
   to 7); stage 10 retires it.

Questionnaire: about 75% standard questions per framework and 25% tailored to the product; four options per question
scored 0 / 35 / 70 / 100 by position.

## Tests

```bash
npm test
npm run build && npx vite preview --port 4173
node tests/e2e/lifecycle.cjs               # landing, registration, all 10 stages, returns, override, incident, retirement
node tests/e2e/drafts-reassess-mobile.cjs  # drafts, re-assessment, mobile layout
node tests/e2e/random-clicks.cjs 7 3       # random clicks on every page for every role
node tests/e2e/evidence.cjs                # upload, open as reviewer, replace, remove evidence files
# Cloud mode, against an in-memory Supabase stand-in (tests/e2e/fake-supabase.cjs):
VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=test npx vite build --outDir dist-cloudtest
npx vite preview --outDir dist-cloudtest --port 4174
node tests/e2e/cloud.cjs
CLOUD=1 node tests/e2e/lifecycle.cjs
CLOUD=1 node tests/e2e/evidence.cjs
```
(e2e scripts need `npm i -D playwright`.)

## Layout

```
api/generate-questions.js   Gemini endpoint (Vercel)
src/data/                   lifecycle.js (charter stages), frameworks.js, questionBank.js, countries.js
src/engine/                 engine.js (scoring, tiers, question selection), report.js
src/store/                  store.jsx (state), sync.js (Supabase reads/writes), seed.js (demo data)
supabase/migrations/        SQL for the v2_ tables
src/pages/                  Landing, Dashboard, Products, Product (lifecycle), NewAssessment, Other, Admin, Catalog
```

Indicative assessment, not legal advice.

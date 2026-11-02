# Fieldwork · Job Search Workspace

Next.js / React / TypeScript interview preparation workspace. Storage and inference are independent: use browser persistence without Supabase, or an authenticated Supabase account. Resume extraction and JD analysis default to an installed local Ollama model. OpenAI remains available through server configuration.

For a code-guided walkthrough with diagrams, start with the [architecture and flow index](docs/architecture/README.md).

## Local setup

Use Node 22.13+ (or a current supported Node 24 release) and pnpm 11.25.0.

```sh
cd job-search-workspace
pnpm install --frozen-lockfile
# If .env.local does not already exist:
cp .env.example .env.local
pnpm dev
```

This checkout includes a non-secret `.env.local` with the local defaults enabled. Preserve any existing configuration rather than overwriting it. The project uses a writable pnpm cache in `../.pnpm-store`.

Open **http://127.0.0.1:3000**. The dev script binds to loopback. Existing `fieldwork-demo-v1` browser data is retained. The initial records are synthetic examples; replace them with your own user-confirmed experience. Browser records belong to that browser origin; localhost and 127.0.0.1 have separate storage.

Ollama/model installation is a separate step; the app never downloads a model. Install the macOS application from [Ollama](https://ollama.com/download), open it, then install the starting model:

```sh
ollama pull qwen3:8b
ollama list
```

If `ollama` is not on PATH, the macOS app commonly includes the binary here:

```sh
/Applications/Ollama.app/Contents/Resources/ollama pull qwen3:8b
```

Configure Ollama's server context to **32,768 tokens** for JD analysis. Quit the Ollama app, run this, then reopen it:

```sh
launchctl setenv OLLAMA_CONTEXT_LENGTH 32768
```

This is an Ollama setting, not a Next.js environment variable. The native extraction request sets its context explicitly; the [OpenAI-compatible endpoint cannot set context per request](https://docs.ollama.com/api/openai-compatibility#setting-the-local-context-size). An alternative is to explicitly create the local alias in `setup/Modelfile` and set `OLLAMA_MODEL=fieldwork-qwen3:8b`. This also reuses the downloaded base model. Large banks may still exceed the available context; keep experience focused and review coverage.

This is a several-GB download. Qwen3 8B is a starting configuration for the M2 Pro/32 GB machine, **not a measured quality or latency recommendation**. The fixed inference address is `http://127.0.0.1:11434`. Models routed to cloud services are outside this local workflow.

The interface shows the active provider/model and a refreshable readiness check. Ollama readiness checks installation via `/api/show`; OpenAI readiness means a server key is configured, not that account access has been verified.

## Import a job listing

In **Applications → Import job from URL**, paste a public HTTPS listing and choose **Fetch page**. Inspect and edit the extracted text before choosing **Extract job details**. Review the company, role and complete JD, then choose **Confirm and save application**. The new application starts at Saved; its final source URL is retained in notes. Only confirmation writes an application. Closing the dialog discards transient source/drafts, while a failed save keeps the review available for retry.

This uses direct server-side page fetching, not Ollama's hosted web search. No search account, API key, browser permission, or additional package is required. Job extraction uses the same `AI_PROVIDER` / model configuration as resume extraction, with a single structured call and no automatic retry or paid fallback. Only inspected page text is sent to the model; the experience bank is not included. You can also paste text or enter details manually without an inference call.

The fetcher prefers a single JSON-LD JobPosting, otherwise readable HTML/main/article content. This is conservative text extraction, not a browser renderer. Login walls, anti-bot restrictions, JavaScript-only pages, compressed responses and unsupported content can require the pasted-text fallback. Review for missing or unrelated sections. Limits: HTTPS on the default port, 15-second fetch, three redirects, 2 MB page, 30,000 source characters; saved JD limit remains 15,000. Oversized fetched content is rejected rather than silently truncated.

For `jobs.gem.com/<board>/<job-id>` pages with insufficient HTML text, the importer also tries [Gem's public Job Board API](https://api.gem.com/job_board/v0/reference). It requests the individual posting, with a board-list lookup only after an individual-posting 404. Results must uniquely match the exact job ID or listing URL; other jobs are never sent to the model. The original listing URL stays in application notes. All requests share the 15-second deadline and existing network/size guards; redirects are limited per resource. Unknown response shapes and unavailable descriptions retain the pasted-text fallback. This adapter is covered with mocked responses; acceptance against the reported live Gem listing remains pending.

Fetch/extraction endpoints use the existing authenticated or explicitly enabled development/loopback/same-origin access guard. Every redirect is checked; private/reserved addresses are denied and validated DNS is pinned to the connection. No browser cookies, session credentials, scripts, embedded resources or page links are loaded. No database migration is needed; both browser storage and Supabase use a stable creation ID to prevent duplicate applications on confirmation retries. A separate intentional import can still create another application.

## Resume → evidence → JD → approved tasks

1. Open **Experience → Import resume**. Upload one text-based PDF (5 MB, ten pages), or paste up to 20,000 characters.
2. Inspect the actual extracted text before sending it to the configured model. Compare columns, dates, missing pages and characters with the original. Switch to pasted text to correct parsing problems.
3. Generate drafts. Review each role/project, edit the saved title/details and structured fields, and confirm that dates, metrics and ownership match your actual work. Missing fields stay empty. Resume citations and page matching are not requested or required.
4. Select entries and confirm. Likely duplicates start deselected. Checking a duplicate explicitly imports a separate record; no merge/overwrite occurs. Selected entries and import metadata are saved; PDF files and complete extracted resumes are not stored. Cancel/reload discards unconfirmed drafts. A failed save retains drafts and stable confirmation identifiers for retry.
5. Add a job under **Applications**, choose **Analyze fit**, review requirements/evidence and approve the preparation plan. Generated tasks are proposals until approval. **Simulated preview** is an explicit separate option that makes no model call.

The PDF is parsed in browser memory with the PDF.js compatibility ESM module and its same-origin worker. Only extracted text/page text is sent to the backend. Encrypted, malformed, scanned/empty, oversized, and partially unreadable documents get errors or warnings with a pasted-text fallback. OCR and DOCX are deferred. Multi-column ordering is not certified automatically.

The bank supports 50 entries. Local confirmation writes the complete validated batch once; Supabase uses a transaction, per-user lock, and uniqueness constraints. Confirmation retries do not overwrite previously saved entries.

## Job-specific preparation targets

Choose **Applications → Prepare for this job**, or open Interview practice and choose **Create preparation group** for one to three applications. The shared **Preparing for…** selector controls Interview practice, Study plan, and Preparation tasks. General practice retains your existing questions, notes, self-scores and general roadmap; old date-specific wording is removed. Selection is remembered separately for browser storage and each account.

1. Complete a current **real** analysis for every selected job. The setup shows missing/outdated analyses with explicit Run real analysis buttons; nothing runs just from selecting a target. Old browser runs without a saved JD snapshot need re-analysis once. Simulated previews cannot feed real preparation generation.
2. Choose start date, **one week**, **two weeks**, or an interview date, and 0.5–40 hours/week. Defaults are today, one week and 12 hours/week. The interview day is included; partial weeks are prorated. Specific dates may be up to one year from the start.
3. Choose **Generate preparation plan**. One structured provider call combines requirements, analysis questions/tasks and referenced experience into questions with suggested answer outlines and prioritized study/practice activities. No browsing, grading, tools, tracing, automatic retry, download or provider fallback occurs. The serialized model input is limited to 60,000 characters without silent truncation; narrow an oversized target or shorten experience and re-analyze.
4. Review questions/outlines, edit activities and estimates (5–120 minutes), change priority, deselect activities, and adjust timing. The schedule recalculates locally without another inference call. Activities are allocated in priority order, preserving input order for ties; indivisible activities that cannot fit any weekly bucket go to **Deferred**. Uncovered requirements are visible.
5. Choose **Activate plan**. Interview practice uses its questions and source evidence; **Save notes and scores** explicitly persists written answers and self-review. Study plan and Preparation tasks share the same completion records, including job/type/status task filters. Writing an answer does not complete a rehearsal. Deferred work is kept outside schedule totals. Earlier approved analysis tasks remain separate from the new schedule.

Changing sources, target membership or timing never rewrites an active plan. Generate, review and activate a new version explicitly. Old versions retain their notes/scores/completion and are read-only; progress is not transferred automatically. Failed saves retain the review; activation retries do not duplicate versions or reset progress. Closing/reloading discards unactivated drafts and unsaved answer edits. A target deletion removes its versions/progress, while deleting an application retains preparation snapshots and marks affected membership as needing repair.

Browser preparation is stored additively under `fieldwork-preparation-v1`; prior `fieldwork-demo-v1` and `fieldwork-practice-*` keys are unchanged. Account storage requires **`supabase/migrations/004_preparation_targets.sql`**, applied after 001–003. It adds per-user target/version/progress tables, immutable plan records and transactional activation/progress RPCs. Apply this in your Supabase project before using signed-in preparation; no migration or Supabase is required for browser mode. No service-role key is used.

API additions: `GET/POST /api/preparation` for authenticated storage, and `POST /api/preparation/generate` for guarded inference. Account generation loads owned sources on the server, ignoring caller-supplied snapshots. Browser inference uses the existing explicitly enabled development/loopback/same-origin guard. Plan versions retain source analyses, JD/experience snapshots and SHA-256 fingerprints, timing, provider/model/prompt metadata, and stable question/activity identifiers.

## Provider configuration

```dotenv
AI_PROVIDER=ollama
OLLAMA_MODEL=qwen3:8b
LOCAL_WORKSPACE_ENABLED=true
```

`LOCAL_WORKSPACE_ENABLED` defaults to **disabled** unless explicitly set. Anonymous inference additionally requires `NODE_ENV=development`, loopback hosting, a matching origin, and no external forwarding/hosting indicators. `pnpm start` and hosted production deployments require authenticated Supabase access even if this flag is copied. Do not expose the development server through a tunnel/proxy.

For OpenAI, change the server configuration and restart:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=your-server-key
OPENAI_MODEL=your-account-model
```

Use a model supporting structured output and function tools. OpenAI usage is billed to that key. No user-supplied keys, browser-visible keys, automatic fallback, SDK retries, or model downloads are implemented. Local runs use a 180-second total deadline; OpenAI uses 45 seconds. JD analysis retains six turns, ten read-only tool executions, output validation and manual task approval. Ollama receives the validated JD/experience snapshot in its initial message, so a structured response without tool calls still has the selected data and exact evidence IDs. The same read-only tools remain available; tool execution is not guaranteed. Analysis errors distinguish timeout, invalid JSON/tool responses, schema/reference failures and the turn limit. Extraction uses one structured model call and no tools. Tracing is disabled. Extraction errors distinguish connection, model, timeout, JSON/schema failures without echoing model output. Provider errors are sanitized; resume/JD contents are not logged by the app.

## Optional Supabase storage / hosted use

1. Create a project at [Supabase Dashboard](https://supabase.com/dashboard/new). Use a personal Free organization for this development setup, name the project `job-search-workspace`, choose a nearby region, and generate/save the database password in your password manager. The app does not need that password. Leave the Data API enabled; this app uses the public schema with explicit grants and row-level security.
2. In the project's SQL Editor, apply **each migration once, in order**: `001_workspace.sql`, `002_resume_import.sql`, `003_resume_without_citations.sql`, then **`004_preparation_targets.sql`** from `supabase/migrations/`. Run one file at a time and stop on an error. For an existing project, apply only migrations not already installed; do not rerun 001 or reset tables.
3. Under Authentication, enable email/password sign-up and leave email confirmation enabled. In URL Configuration, set **Site URL** to `http://127.0.0.1:3000` and add `http://127.0.0.1:3000/**` to allowed redirect URLs. If you intentionally use `localhost`, also add `http://localhost:3000/**`; browser records on that origin remain separate. Signup requests explicitly return to the origin where the app was opened. Use exact production URLs when deploying.
4. Copy the **project URL** and **publishable key** (`sb_publishable_…`) from the project's Connect dialog into `.env.local`, preserving the existing model settings:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
   ```

   These values are public client configuration. A legacy `anon` key is also supported. Never put a secret/service-role key or a database password in a `NEXT_PUBLIC_*` variable. Invalid or incomplete settings show a configuration message while browser storage remains available. `.env.local` is ignored by Git.

5. Restart `pnpm dev` because Next's public configuration is included in the client bundle. Open `http://127.0.0.1:3000`, choose Sign in → Create account, then follow the confirmation email back to the app. If confirmation does not start a session, sign in with the same email/password.
6. Verify account storage with a synthetic experience and application: save both, reload, sign out, and sign back in. Browser records should reappear on sign-out; account records should reappear on sign-in. A second account must see an empty private workspace. Then run a real analysis and exercise target creation, plan activation, and progress saving to check migration 004.

Supabase here provides hosted authentication and database persistence. Keep `AI_PROVIDER=ollama` while Next runs on your laptop; the database does not run the model. A hosted Next server's `127.0.0.1` is that server, not your laptop; choose an available server-side provider such as OpenAI for a normal Vercel deployment. No cloud model hosting is provisioned here.

If email confirmation returns to the wrong host, check Site URL, the redirect allowlist, and your browser origin. If account creation reports an email rate limit or delivery failure, check the project's Auth logs/email configuration and retry after the reported delay; the app does not automatically retry sign-ups. If sign-in succeeds but data reads fail, confirm all four SQL migrations finished successfully and the Data API exposes the public schema. Setup references: [Next.js project configuration](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs), [Auth redirects](https://supabase.com/docs/guides/auth/redirect-urls).

Migration 003 removes the required resume excerpts from the import RPC while preserving existing records. Apply it after 002 if upgrading an existing Supabase workspace. Browser storage needs no migration.

Migration 002 is additive for data: existing manual experience and analysis history remain valid. It adds optional provenance/import identifiers, retry uniqueness, a database capacity guard, provider metadata, a transactional `import_resume_experience` RPC, and a five-minute stale-analysis cutoff. The reservation RPC gains an optional fourth provider argument; existing three-argument callers still work. Back up your database and apply once through migrations; do not rerun migration 001 against an existing database.

Only the publishable Supabase key and user token are used; no service-role key. Ownership comes from `auth.uid()`, with row-level security and authenticated function grants. Historical analyses keep their evidence snapshots. Authenticated analysis quota remains ten runs/hour across job deletion. Sign-in switches storage rather than automatically migrating browser records to an account.

## Checks and evaluation

```sh
pnpm typecheck
pnpm test
pnpm build
```

Tests cover grounding contracts, both actual SDK transports with mocked HTTP, provider/access boundaries, PDF parsing policies, retry safety, database transactions/RLS/capacity, and existing workflow regression cases. See [VERIFICATION.md](VERIFICATION.md) for exactly what was executed and what remains unverified.

Run the labeled **synthetic** extraction dataset against the selected provider:

```sh
pnpm eval:resume
```

Eight cases cover missing dates, multiple roles, standalone projects, shared ownership, metrics, injection and skills-only content. Results under ignored `evals/results/` contain actual field matching/counts, invented-phrase flags, latency, failures and pending manual semantic review. Do not treat string matching as a complete measure of invented claims. No model quality result is claimed before successful runs and human review.

Paid comparisons require explicit opt-in:

```sh
# Select OpenAI in .env.local first. These commands incur API usage.
pnpm eval:resume --allow-paid
pnpm eval:live --allow-paid
```

The original JD comparison performs baseline + grounded runs across 20 cases (40 model runs). No paid comparison runs automatically in tests/CI.

## Implementation map

- `components/job-import.tsx`, `lib/job-page.ts`, `lib/job-extraction.ts`: URL/pasted text → source inspection → job extraction → editable confirmation.
- `/api/jobs/fetch`, `/api/jobs/extract`: independent guarded page-fetch and model-extraction routes.
- `components/resume-import.tsx`: input, inspection, review, confirmation; transient drafts.
- `lib/pdf-text.ts`, `lib/pdf-browser.ts`: parsing limits, warnings and bundled worker.
- `lib/resume.ts`: schemas, draft validation, duplicate checks and local import idempotency.
- `lib/resume-extraction.ts`: native Ollama / OpenAI structured extraction.
- `lib/ai-provider.ts`, `lib/agent.ts`: fixed provider transport, deadlines and bounded JD agent.
- `/api/ai/status`, `/api/resume/extract`, `/api/analyze/local`, `/api/experience/import`: new routes.
- `002_resume_import.sql`, `003_resume_without_citations.sql`: ownership-preserving persistence changes and citation-free imports.

PDF.js 5.6.205 is vendored as a browser-only package because registry access was unavailable during implementation. Its Apache-2.0 license, upstream attribution and update notes are in `vendor/pdfjs/`; the module and worker are served directly from versioned local assets to avoid rebundling PDF.js’s internal runtime, and fonts/CMaps/WASM are served from `public/pdf-assets`. No CDN code is loaded.

PDF ingestion and inference are separate so parsing errors can be diagnosed without a model call. Portfolio rationale and remaining evaluation work: [CASE-STUDY.md](CASE-STUDY.md).

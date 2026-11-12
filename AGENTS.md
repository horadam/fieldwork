<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fieldwork · Job Search Workspace

Interview-prep workspace: resume import → experience bank → JD fit analysis → activated preparation plan. Storage (browser or Supabase) and inference (Ollama or OpenAI) are independent.

## Stack

- Next.js 16.4 (App Router, `--webpack`), React 19.3, TypeScript 5.9 (strict), Tailwind 4.3
- Zod 4 for every schema crossing a boundary (API bodies, model output, storage)
- AI: `openai` 7 + `@openai/agents` 0.20; default provider is local Ollama (`qwen3:8b`)
- Supabase (auth + Postgres with RLS); PGlite runs the migrations in tests
- Vitest 3, Prettier 3, pnpm 11.25 (not npm), Node 22.13+

## Commands

- Dev: `pnpm dev` (binds 127.0.0.1:3000)
- Test: `pnpm test` — one file: `pnpm test tests/resume.test.ts`
- Typecheck: `pnpm typecheck`
- Format: `pnpm format` / `pnpm format:check`
- Full gate (same as CI): `pnpm check` (typecheck + test + build)
- Lint: none configured yet (`next lint` was removed in Next 16)
- Migrations: SQL files in `supabase/migrations/`, applied in order by hand in the Supabase SQL editor. Never edit an applied migration; add `00N_*.sql`.
- Evals: `pnpm eval:resume`, `pnpm eval:job`, `pnpm eval:prep` (local Ollama); `pnpm eval:live --allow-paid` (OpenAI, billed — never run without being asked). Record notable runs in `evals/results.md`

## Layout

- `app/api/*/route.ts` — thin route handlers: parse with Zod, call `lib/`, return JSON
- `lib/` — all logic. LLM calls live only in `lib/agent.ts` (JD analysis, Agents SDK) and `lib/resume-extraction.ts`, `lib/job-extraction.ts`, `lib/preparation-generation.ts`, which all go through `lib/model-call.ts` (deadline, no retry, sanitized errors, usage). Provider config is `lib/ai-provider.ts`. Client storage goes through `lib/store/` and `lib/api-client.ts`
- `lib/server.ts` — auth / local-access guard; every inference route must go through it
- `components/` — client UI; `workspace.tsx` is the shell, with `hooks/`, `shell/`, `views/`, `modals/`; preparation lives in `preparation-workspace.tsx` + `preparation/`
- `tests/` — Vitest; HTTP and model providers are mocked, DB tests use PGlite
- `evals/` — labeled cases; `scripts/evaluate*.ts` run them
- `docs/architecture/` — flow docs; update when a data flow changes

## Conventions

- Model output is untrusted: validate with Zod and check evidence IDs against inputs before use.
- No automatic retries or provider fallback. Explicit deadlines on every model call.
- Provider errors are sanitized; never log resume/JD contents or echo model output in errors.
- Generated content is a draft until the user confirms; writes use stable IDs so retries are idempotent.
- Reject oversized input; never truncate silently.
- Record `durationMs` and token usage on every model call.
- Lines: 1px `--line` hairlines separate or outline (card borders, list rows, sections). Thick lines (2–3px) are colored and mark emphasis (active tab, quoted evidence, accent edges); never use a thick grey line as a divider. Progress is a rounded `.meter` under its label, so it never reads as a rule.
- Data, not sentences: facts about an item (dates, minutes, type, model) go in a `Meta` row (`components/ui/meta.tsx`), categories in a `.chip`, and anything plural in a real list (`.bullets`, `SourceList` for covered requirements, `.week-items` for schedules). Don't join different pieces of data into one string with " / " or "; ".
- UI spacing: use the `--space-*` tokens in `app/globals.css`. Space between items comes from the container (the flow rule for cards, notices and disclosures, or `gap` in flex/grid), not from margins on individual buttons or paragraphs.
- Motion: there is none yet. The first `transition` or `animation` added must come with a `prefers-reduced-motion: reduce` rule that removes it.

## Learnings

- Read `docs/LEARNINGS.md` before working in an area it covers (CSP and headers, deployment, Supabase, model calls, tests).
- When something non-obvious costs you time (a trap, a hidden constraint, a fix that only works one way), add a short dated entry: what happens, why, and where. Remove entries the code has made obsolete. Don't record what the code or git history already says.

## Definition of done

- `pnpm typecheck` and `pnpm test` pass; `pnpm build` passes for UI/route changes
- New behavior has a test; a bug fix has a regression test
- No secrets in code or fixtures; don't read or print `.env.local`
- README/docs updated when setup or a user-visible flow changes

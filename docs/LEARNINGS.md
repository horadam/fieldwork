# Learnings

Non-obvious things this project has taught its contributors, human or agent. Read it before changing the areas below; add to it when something surprises you. Each entry says what happens, why, and where it matters. Keep entries short, and delete one when the code makes it obsolete.

## Security headers and CSP

- **`Referrer-Policy` must stay `same-origin`.** The local-development guard (`localWorkspaceAllowed` in `lib/server.ts`) checks `Referer` on same-origin GET requests. `no-referrer` silently turns local Ollama mode into "unavailable". (2026-11-03)
- **The nonce-based CSP needs a per-request page.** `app/page.tsx` calls `connection()` so each response gets its own nonce from `proxy.ts`. A statically rendered page has no nonce and its scripts are blocked. (2026-11-03)
- **`next dev` injects stylesheets without the nonce**, so development allows inline styles and `eval`. Check the strict policy against a production build (`pnpm build`, then the `prod` launch config on port 3100), not the dev server. (2026-11-03)
- **Browser automation can bypass the CSP.** Scripts injected by a test tool's JavaScript run anyway. A meaningful check is an injected inline handler (`<img onerror=…>`), which the policy blocks and reports. (2026-11-03)
- **PDF.js needs `worker-src 'self' blob:` and `'wasm-unsafe-eval'`.** Test PDF import after any CSP change. (2026-11-03)

## Next.js and deployment

- **`NEXT_PUBLIC_` values are built into the page.** After changing them in Vercel, redeploy; existing deployments keep the old values. (2026-11-05)
- **`next dev` reads header config only at startup.** Editing a file that `next.config.ts` imports (e.g. `lib/security-headers.ts`) doesn't apply until `next.config.ts` itself changes or the server restarts. (2026-11-03)
- **Next 16.4.0 builds abort with `SecurityFatalError`;** 16.4.1 is the first patched release. (2026-11-03)

## Supabase

- **Use "Add user", not "Invite user".** Invite sends a magic link, and the app has no set-password screen, so invited people can't sign in with a password later. (2026-11-05)
- **`NEXT_PUBLIC_SIGNUPS=closed` only hides the button.** Supabase's "Allow new users to sign up" switch is what enforces invite-only. (2026-11-05)
- **Create the browser Supabase client once per page.** React runs effects twice in development, and Fast Refresh remounts components, so `createClient` inside an effect makes several clients on the same session ("Multiple GoTrueClient instances"). Use `browserSupabase()` in `lib/supabase-browser.ts`. (2026-11-05)
- **The built-in mailer is for testing.** It sends a handful of emails per hour, only to members of the Supabase organization, so open sign-up on a public site needs custom SMTP. (2026-11-05)

## Model calls

- **Constrain IDs in the schema rather than the prompt.** Plans failed validation on invented link IDs until the output schema allowed only real keys (`lib/plan-links.ts`); the plan eval went from 1 to 2 of 3. Prefer enums of valid IDs wherever a model must reference its inputs. (2026-11-05)
- **A visitor's OpenAI key is a non-enumerable field on `Provider`,** so spreading or serializing a config can't leak it. Keep it that way, and never forward OpenAI's error text, which can quote the key. (2026-11-03)
- **OpenAI has no prices API.** Prices are a dated table in `lib/pricing.ts`, checked by hand against <https://developers.openai.com/api/docs/pricing>; `openai.com/api/pricing` refuses automated fetches. (2026-11-03)
- **A truncated Ollama reply has no `message`.** The envelope schema keeps it optional so truncation is reported as truncation, not as a malformed reply. (2026-11-02)

## Tests and tooling

- **Vitest's fake timers don't fake `AbortSignal.timeout`.** Deadline tests use short real deadlines. (2026-11-02)
- **`.prettierignore` must keep `.claude/`.** Other sessions' worktrees live there, with vendored PDF.js that `pnpm format` would otherwise rewrite. (2026-11-02)
- **The TypeScript lib is ES2022,** so `Array.prototype.findLast` isn't available; use `[...items].reverse().find(...)`. (2026-11-02)
- **Eval scores are heuristics.** Review the raw outputs in `evals/results/` before citing a number, and record notable runs in `evals/results.md`. (2026-11-02)

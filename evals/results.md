# Eval results

Local runs on 2026-11-02 with Ollama `qwen3:8b`, on synthetic cases only. They were run one at a time with no retries. Pass/fail comes from the deterministic scorers in `score.ts`, which CI unit-tests against canned outputs. These scores are heuristics: review the raw outputs in the ignored `evals/results/*.json` before citing them.

| Eval         | Command            | Cases | Passed | Execution failures | Median latency | Tokens (in / out) |
| ------------ | ------------------ | ----- | ------ | ------------------ | -------------- | ----------------- |
| Resume       | `pnpm eval:resume` | 8     | 8      | 0                  | 3.8 s          | 3,809 / 693       |
| Job import   | `pnpm eval:job`    | 8     | 7      | 0                  | 6.8 s          | 2,749 / 1,440     |
| Prep plan    | `pnpm eval:prep`   | 3     | 1      | 1                  | 27.3 s         | 2,019 / 2,171     |
| Fit analysis | `pnpm eval:live`   | 20    | —      | —                  | —              | —                 |

Resume and job rows use prompts `resume-v4` and `job-import-v2`. The prep row uses `preparation-v1`. Fit analysis is not included: its eval uses OpenAI, is billed, and has not been run.

## Findings and fixes

- **Prompt injection in job pages: fixed, though the result is incomplete.** With `job-import-v1`, injected text set the company to "EvilCorp" and the role to "Chief Executive". `job-import-v2` tells the model to ignore text addressed to it. If a company or role appears in the source only inside instruction-like lines, `guardInjectedFields()` now clears it with a warning. In the rerun, nothing injected reached the draft, but the model also left the real company and role blank. The case still fails the strict scorer; the user fills in both fields at review.
- **Split resume drafts: fixed.** With `resume-v3`, the model sometimes split a role's bullet points into a separate "project" at the same organization, with no role or dates. `mergeOrphanedProjects()` now folds them back into the role with a warning, and the prompt says that bullets belong to their role. In the rerun, `single-role` and `missing-dates` pass.
- **Project names: fixed.** In `standalone-project`, the project name had come back as an empty organization. The prompt now says to put the project name there, and the rerun passes.
- **Plan references can be invalid: open.** In `two-jobs-combined`, validation rejected the output (`preparation_invalid_output`), so no draft was shown.
- **Tight budgets drop gaps and practice: open.** At 1 hour a week, two of the four gap requirements had no scheduled work, and the plan had no question practice.

The first local run (`resume-v3`, `job-import-v1`) passed 5 of 8 resume cases and 7 of 8 job cases.

## Earlier record

A run on 2026-10-21 recorded 0 of 8 resume cases. A sandbox blocked the connection to Ollama, so it measured nothing about model quality. The citation metrics in that record were dropped when citations were removed (migration 003).

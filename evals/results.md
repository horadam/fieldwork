# Eval results

Local runs on 2026-11-02 (resume, job) and 2026-11-05 (prep plan) with Ollama `qwen3:8b`, on synthetic cases only. They were run one at a time with no retries. Pass/fail comes from the deterministic scorers in `score.ts`, which CI unit-tests against canned outputs. These scores are heuristics: review the raw outputs in the ignored `evals/results/*.json` before citing them.

| Eval         | Command            | Cases | Passed | Execution failures | Median latency | Tokens (in / out) |
| ------------ | ------------------ | ----- | ------ | ------------------ | -------------- | ----------------- |
| Resume       | `pnpm eval:resume` | 8     | 8      | 0                  | 3.8 s          | 3,809 / 693       |
| Job import   | `pnpm eval:job`    | 8     | 7      | 0                  | 6.8 s          | 2,749 / 1,440     |
| Prep plan    | `pnpm eval:prep`   | 3     | 2      | 0                  | 37.6 s         | 2,261 / 2,897     |
| Fit analysis | `pnpm eval:live`   | 20    | —      | —                  | —              | —                 |

Resume and job rows use prompts `resume-v4` and `job-import-v2`. The prep row uses `preparation-v2`; with `preparation-v1` it passed 1 of 3 with 1 execution failure. Fit analysis is not included: its eval uses OpenAI, is billed, and has not been run.

## Findings and fixes

- **Prompt injection in job pages: fixed, though the result is incomplete.** With `job-import-v1`, injected text set the company to "EvilCorp" and the role to "Chief Executive". `job-import-v2` tells the model to ignore text addressed to it. If a company or role appears in the source only inside instruction-like lines, `guardInjectedFields()` now clears it with a warning. In the rerun, nothing injected reached the draft, but the model also left the real company and role blank. The case still fails the strict scorer; the user fills in both fields at review.
- **Split resume drafts: fixed.** With `resume-v3`, the model sometimes split a role's bullet points into a separate "project" at the same organization, with no role or dates. `mergeOrphanedProjects()` now folds them back into the role with a warning, and the prompt says that bullets belong to their role. In the rerun, `single-role` and `missing-dates` pass.
- **Project names: fixed.** In `standalone-project`, the project name had come back as an empty organization. The prompt now says to put the project name there, and the rerun passes.
- **Plan references can be invalid: fixed.** With `preparation-v1`, `two-jobs-combined` linked to something that didn't exist, and validation rejected the whole plan (`preparation_invalid_output`). The model's output schema now only accepts link keys that exist (`modelPlanSchema()`); `repairPlan()` removes any stray link and reports it in the draft review; and failures name their reason, which the eval now records. In the rerun, all three plans needed no repairs. `two-jobs-combined` still fails the scorer, for the reason below.
- **Plans can lack question practice: open.** `two-jobs-combined` produced a plan with no question-practice activity (and no repairs, so none was removed).
- **Tight budgets defer gap work: open.** At 1 hour a week, two of the four gap requirements still have no scheduled work. The rerun did include question practice, so that case now passes.

The first local run (`resume-v3`, `job-import-v1`) passed 5 of 8 resume cases and 7 of 8 job cases.

## Earlier record

A run on 2026-10-21 recorded 0 of 8 resume cases. A sandbox blocked the connection to Ollama, so it measured nothing about model quality. The citation metrics in that record were dropped when citations were removed (migration 003).

## Conversational practice · 2026-11-06

Ran `pnpm eval:practice` locally on Qwen3 8B with four synthetic answers: vague ownership, a concrete tradeoff, an unsupported metric and an instruction-injection answer. The first attempt was blocked by the sandbox; it measured no quality. After network access was granted, both `practice-v1` and revised `practice-v2` completed all four calls with structurally valid output. The v2 median response time was 5.3 seconds. No paid calls were made.

Manual review found important limitations, even after the prompt revision: Qwen still gives vague praise to the unsupported metric and instruction-only answer; it can ask for a tradeoff already explained, and can overemphasize missing quantitative results. It did not invent the requested revenue achievement or award a hiring decision, and the metric follow-up in v2 asked about the baseline. These are observations on four cases, not a quality pass rate. Treat the coach as experimental; human review remains necessary. The dataset and harness are in `evals/practice/` and `scripts/evaluate-practice.ts`. Mocked tests establish bounds, validation and persistence, not semantic accuracy.

New plans use `preparation-v3`: if the model omits linked question practice, a disclosed 15-minute rehearsal is added for review (or an already full plan is rejected). This deterministic coverage correction has regression coverage; it has not been counted as a new model-evaluation result.

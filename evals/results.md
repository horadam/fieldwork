# Eval results

Local runs on 2026-11-02 with Ollama `qwen3:8b`, on synthetic cases only. They were run one at a time with no retries. Pass/fail comes from the deterministic scorers in `score.ts`, which CI unit-tests against canned outputs. These scores are heuristics: review the raw outputs in the ignored `evals/results/*.json` before citing them.

| Eval         | Command            | Cases | Passed | Execution failures | Median latency | Tokens (in / out) |
| ------------ | ------------------ | ----- | ------ | ------------------ | -------------- | ----------------- |
| Resume       | `pnpm eval:resume` | 8     | 5      | 0                  | 4.7 s          | 3,513 / 767       |
| Job import   | `pnpm eval:job`    | 8     | 7      | 0                  | 7.6 s          | 2,317 / 1,640     |
| Prep plan    | `pnpm eval:prep`   | 3     | 1      | 1                  | 27.3 s         | 2,019 / 2,171     |
| Fit analysis | `pnpm eval:live`   | 20    | —      | —                  | —              | —                 |

Fit analysis is not included: its eval uses OpenAI, is billed, and has not been run.

## Findings

- **Prompt injection reaches job drafts.** In `prompt-injection`, the injected text set the company to "EvilCorp" and the role to "Chief Executive". Nothing is saved until the user reviews the draft, but extraction itself is not robust to injection.
- **Spurious empty resume drafts.** In `single-role` and `missing-dates`, the model added a second draft with the organization repeated and an empty role. Every expected field was still correct.
- **Projects lose their name.** In `standalone-project`, the project name was returned as an empty organization.
- **Plan references can be invalid.** In `two-jobs-combined`, validation rejected the output (`preparation_invalid_output`), so no draft was shown.
- **Tight budgets drop gaps and practice.** At 1 hour a week, two of the four gap requirements had no scheduled work, and the plan had no question practice.

## Earlier record

A run on 2026-10-21 recorded 0 of 8 resume cases. A sandbox blocked the connection to Ollama, so it measured nothing about model quality. The citation metrics in that record were dropped when citations were removed (migration 003).

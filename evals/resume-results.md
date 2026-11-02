# Local extraction evaluation status

Attempted 2026-10-21 with the eight labeled synthetic cases in `resume-cases.ts`, provider Ollama, configured model qwen3:8b.

| Measure                      | Actual result                   |
| ---------------------------- | ------------------------------- |
| Cases attempted              | 8                               |
| Successful extractions       | 0                               |
| Execution failures           | 8                               |
| Field accuracy               | Not measurable: no model output |
| Invented claims              | Not measurable                  |
| Citation validity            | Not measurable                  |
| Successful inference latency | Not measurable                  |
| Human semantic review        | Pending                         |

The session blocks connections to local inference. These failures do not measure model quality. No paid comparisons were made. Raw attempt records remain under ignored `evals/results/`. Run `pnpm eval:resume` with Ollama available, inspect outputs and complete manual review before replacing this record with quality results.

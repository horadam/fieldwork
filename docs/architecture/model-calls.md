# Model calls

[Architecture index](README.md)

## How to read this diagram

Every inference request follows the same path. Resume extraction, job extraction
and preparation generation each make one structured call through
`structuredCompletion()`. Fit analysis uses the Agents SDK, because it needs
read-only tools, but it follows the same deadline, retry and usage rules.

```mermaid
flowchart TB
  ROUTE["Route handler"] --> GUARD["inferenceAccess(): signed-in user or local dev"]
  GUARD --> QUOTA{"Signed in?"}
  QUOTA -->|"Yes"| RESERVE["reserve_inference(kind): hourly limit"]
  QUOTA -->|"No (local dev)"| CALL
  RESERVE -->|"Over limit"| E429["429, no model call"]
  RESERVE --> CALL["structuredCompletion()"]
  CALL --> DEADLINE["AbortSignal: provider deadline + caller cancel"]
  DEADLINE --> PROVIDER{"AI_PROVIDER"}
  PROVIDER -->|"ollama"| OLLAMA["POST /api/chat, JSON schema format; envelope checked with Zod"]
  PROVIDER -->|"openai"| OPENAI["chat.completions, zodResponseFormat, maxRetries 0"]
  OLLAMA --> CHECKS["Truncation, empty output, JSON parse"]
  OPENAI --> CHECKS
  CHECKS --> VALIDATE["Flow's validate(): schema and references"]
  VALIDATE -->|"Accepted"| OK["{ output, metadata: provider, model, promptVersion, durationMs, tokens }"]
  CHECKS -->|"Rejected"| ERR["AIError: code, status, sanitized message, usage"]
  VALIDATE -->|"Rejected"| ERR
```

## Rules this path enforces

- **One attempt.** There are no automatic retries and no provider fallback.
  Ollama failures say that no OpenAI request was made.
- **Deadlines.** 180 seconds for Ollama and 45 seconds for OpenAI. A timeout maps
  to `inference_timeout` (504), and a cancelled request maps to
  `inference_cancelled` (499).
- **Untrusted output.** Model text is parsed and validated before use. Evidence
  and requirement IDs are checked against the inputs, and a preparation plan may
  only cite evidence the model was shown.
- **Sanitized errors.** Provider error bodies are never forwarded, because they can
  echo resume or JD text. Codes follow `<flow>_<reason>`, for example
  `job_invalid_json` or `preparation_truncated`.
- **Usage everywhere.** Successful calls return `metadata` with duration and
  token counts. Failed calls attach the same information as `AIError.usage`, so a
  rejected analysis is still recorded with its real cost.
- **No silent truncation.** Oversized inputs are rejected before the call.
  Over-long outputs, such as a JD above 15,000 characters, get their own error.

## Hosted quota

[Migration 005](../../supabase/migrations/005_inference_usage.sql) adds an
`inference_usage` ledger and `reserve_inference(kind)`. The hourly limits are:

| Kind                     | Limit per hour |
| ------------------------ | -------------- |
| `resume_extraction`      | 10             |
| `job_extraction`         | 20             |
| `preparation_generation` | 10             |

Fit analysis keeps its own limit of ten per hour in `start_analysis`. A
reservation counts even when the call later fails, as analysis reservations do.
Local development calls without an account are not metered.

## Implementation

- [Shared call path](../../lib/model-call.ts),
  [provider configuration and errors](../../lib/ai-provider.ts),
  [quota helper](../../lib/server.ts).
- Callers: [resume](../../lib/resume-extraction.ts), [job](../../lib/job-extraction.ts),
  [preparation](../../lib/preparation-generation.ts), [fit analysis](../../lib/agent.ts).
- Tests: [wrapper](../../tests/model-call.test.ts),
  [quota in Postgres](../../tests/inference-quota.test.ts).

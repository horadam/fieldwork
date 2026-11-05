import { mkdir, writeFile } from "node:fs/promises";
import { providerConfig, type Provider } from "../lib/ai-provider";
import { AIError } from "../lib/ai-provider";

type Outcome = {
  id: string;
  passed: boolean;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  // Fixed, content-free reason from the app's own error message.
  reason?: string;
  score?: unknown;
};

/**
 * Runs eval cases one at a time against the configured provider and saves raw
 * results under the ignored evals/results/. OpenAI runs are billed, so they
 * need --allow-paid. Model text is not printed: only scores and error codes.
 */
export async function runEval<C extends { id: string }>(
  name: string,
  cases: C[],
  run: (
    c: C,
    config: Provider,
  ) => Promise<{
    score: { passed: boolean };
    metadata: { durationMs: number; inputTokens: number; outputTokens: number };
    output: unknown;
  }>,
) {
  const config = providerConfig();
  if (config.provider === "openai" && !process.argv.includes("--allow-paid"))
    throw new Error(
      "OpenAI evals are billed: add --allow-paid to opt in, or select Ollama.",
    );
  const outcomes: (Outcome & { output?: unknown })[] = [];
  for (const c of cases) {
    const started = Date.now();
    try {
      const { score, metadata, output } = await run(c, config);
      outcomes.push({
        id: c.id,
        passed: score.passed,
        ...metadata,
        score,
        output,
      });
    } catch (error) {
      const usage = error instanceof AIError ? error.usage : undefined;
      outcomes.push({
        id: c.id,
        passed: false,
        durationMs: usage?.durationMs ?? Date.now() - started,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        error: error instanceof AIError ? error.code : "execution_failed",
        reason: error instanceof AIError ? error.message : undefined,
      });
    }
    const last = outcomes.at(-1)!;
    console.log(
      `${last.passed ? "pass" : "FAIL"}  ${c.id}  ${(last.durationMs / 1000).toFixed(1)}s${last.error ? `  ${last.error}` : ""}`,
    );
  }
  const succeeded = outcomes.filter((o) => !o.error);
  const latencies = succeeded.map((o) => o.durationMs).sort((a, b) => a - b);
  const summary = {
    eval: name,
    provider: config.provider,
    model: config.model,
    createdAt: new Date().toISOString(),
    cases: outcomes.length,
    passed: outcomes.filter((o) => o.passed).length,
    executionFailures: outcomes.length - succeeded.length,
    medianLatencyMs: latencies.length
      ? latencies[Math.floor(latencies.length / 2)]
      : null,
    totalInputTokens: outcomes.reduce((n, o) => n + o.inputTokens, 0),
    totalOutputTokens: outcomes.reduce((n, o) => n + o.outputTokens, 0),
  };
  await mkdir("evals/results", { recursive: true });
  const file = `evals/results/${name}-${config.provider}-${Date.now()}.json`;
  await writeFile(file, JSON.stringify({ summary, outcomes }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(
    `Saved raw results to ${file}. Review outputs before citing scores.`,
  );
  process.exitCode = summary.executionFailures > 0 ? 1 : 0;
  return summary;
}

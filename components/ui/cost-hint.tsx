"use client";
import { formatCost, modelPrice, stepCeiling, type Step } from "@/lib/pricing";
import type { AiStatus } from "../hooks/use-ai-status";

// The most an AI step can cost, before it runs. The ceiling comes from the
// step's reply limit and the size of the text it sends, so it is an upper
// bound; the actual tokens and cost are shown after the step finishes.
export function CostHint({
  ai,
  step,
  sourceChars,
}: {
  ai: AiStatus | null;
  step: Step;
  sourceChars: number;
}) {
  if (!ai?.ready) return null;
  if (ai.provider === "ollama")
    return <p className="cost-hint">Runs on local Ollama · no API cost.</p>;
  const ceiling = stepCeiling(step, sourceChars);
  const price = modelPrice(ai.provider, ai.model);
  const whose = ai.source === "user" ? "your OpenAI key" : "the server's key";
  const limit = price
    ? `at most ≈ ${formatCost(
        (ceiling.inputTokens * price.input +
          ceiling.outputTokens * price.output) /
          1e6,
      )}`
    : `at most ≈ ${ceiling.inputTokens.toLocaleString("en-US")} in / ${ceiling.outputTokens.toLocaleString("en-US")} out tokens`;
  return (
    <p className="cost-hint">
      Uses {whose} · {ai.model} · {limit}
    </p>
  );
}

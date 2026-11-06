// Cost information for model calls. Shared by server and browser, so it holds
// no secrets. Figures are estimates: the provider's own usage page is the bill.

export const PRICES_AS_OF = "2026-11-03";
export const PRICING_URL = "https://developers.openai.com/api/docs/pricing";
export const USAGE_URL = "https://platform.openai.com/usage";
export const KEYS_URL = "https://platform.openai.com/api-keys";
// Suggested for visitors who bring their own key; any listed model works.
export const DEFAULT_USER_MODEL = "gpt-6.1-terra";

// USD per 1M tokens, Standard tier, short context (every step here stays far
// below the 272K long-context threshold). Source: PRICING_URL on PRICES_AS_OF.
const OPENAI_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-6-astra": { input: 10, output: 50 },
  "gpt-6.1-sol": { input: 2, output: 10 },
  "gpt-6.1-terra": { input: 1, output: 5 },
  "gpt-6-sol": { input: 2, output: 10 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-5.6-sol": { input: 4, output: 20 },
  "gpt-5.6-terra": { input: 2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "gpt-5.5": { input: 5, output: 30 },
  "gpt-5.4": { input: 2.5, output: 15 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};
export const PRICED_MODELS = Object.keys(OPENAI_PRICES);

export type Price = { input: number; output: number };
// null means unknown (show tokens only); local models cost nothing.
export function modelPrice(provider: string, model: string): Price | null {
  if (provider === "ollama") return { input: 0, output: 0 };
  if (provider !== "openai") return null;
  // Dated snapshots, e.g. gpt-4o-2024-08-06, share their base model's price.
  return (
    OPENAI_PRICES[model] ??
    OPENAI_PRICES[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")] ??
    null
  );
}

export function callCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = modelPrice(provider, model);
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1e6;
}

export function formatCost(usd: number) {
  if (usd === 0) return "$0";
  if (usd < 0.001) return "< $0.001";
  if (usd < 0.1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

// Each step's reply limit (its maxTokens) and the tokens its instructions and
// output schema add on top of the user's text. Instruction sizes were measured
// on the local evals and rounded up for OpenAI, which also counts the schema.
export type Step = "resume" | "job" | "analysis" | "preparation" | "practice";
export const STEPS: Record<
  Step,
  { label: string; maxOutput: number; overhead: number; maxTurns: number }
> = {
  practice: {
    label: "Interview answer",
    maxOutput: 1800,
    overhead: 1400,
    maxTurns: 1,
  },
  resume: {
    label: "Resume import",
    maxOutput: 6500,
    overhead: 1000,
    maxTurns: 1,
  },
  job: { label: "Job extraction", maxOutput: 5500, overhead: 800, maxTurns: 1 },
  // The agent may read its tools before answering; each turn resends the
  // conversation so far, so the ceiling counts every allowed turn.
  analysis: {
    label: "Fit analysis",
    maxOutput: 4500,
    overhead: 1500,
    maxTurns: 6,
  },
  preparation: {
    label: "Preparation plan",
    maxOutput: 10000,
    overhead: 1500,
    maxTurns: 1,
  },
};

export const estimateTokens = (chars: number) => Math.ceil(chars / 4);

// The most a step can use for a given amount of source text.
export function stepCeiling(step: Step, sourceChars: number) {
  const s = STEPS[step];
  return {
    inputTokens: s.maxTurns * (s.overhead + estimateTokens(sourceChars)),
    outputTokens: s.maxTurns * s.maxOutput,
  };
}

// Running total of this browser session's model calls.
export type SessionUsage = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  // Cost of the calls whose price is known; `unpriced` counts the rest.
  cost: number;
  unpriced: number;
};
export const emptyUsage: SessionUsage = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cost: 0,
  unpriced: 0,
};
export type CallRecord = {
  provider?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
};
export function addUsage(total: SessionUsage, call: CallRecord): SessionUsage {
  const cost =
    call.provider && call.model
      ? callCost(call.provider, call.model, call.inputTokens, call.outputTokens)
      : null;
  return {
    calls: total.calls + 1,
    inputTokens: total.inputTokens + call.inputTokens,
    outputTokens: total.outputTokens + call.outputTokens,
    cost: total.cost + (cost ?? 0),
    unpriced: total.unpriced + (cost === null ? 1 : 0),
  };
}

// "1,240 in / 610 out tokens · ≈ $0.0009" for a finished call.
export function usageLabel(call: CallRecord) {
  const tokens = `${call.inputTokens.toLocaleString("en-US")} in / ${call.outputTokens.toLocaleString("en-US")} out tokens`;
  if (call.provider === "ollama") return `${tokens} · no API cost`;
  const cost =
    call.provider && call.model
      ? callCost(call.provider, call.model, call.inputTokens, call.outputTokens)
      : null;
  return cost === null ? tokens : `${tokens} · ≈ ${formatCost(cost)}`;
}

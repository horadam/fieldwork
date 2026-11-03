import { describe, expect, it } from "vitest";
import {
  addUsage,
  callCost,
  emptyUsage,
  formatCost,
  modelPrice,
  STEPS,
  stepCeiling,
  usageLabel,
} from "../lib/pricing";

describe("model prices", () => {
  it("knows listed OpenAI models and their dated snapshots", () => {
    expect(modelPrice("openai", "gpt-6.1-terra")).toEqual({
      input: 1,
      output: 5,
    });
    expect(modelPrice("openai", "gpt-4o-2024-08-06")).toEqual(
      modelPrice("openai", "gpt-4o"),
    );
  });

  it("treats local models as free and unknown ones as unpriced", () => {
    expect(callCost("ollama", "qwen3:8b", 5000, 5000)).toBe(0);
    expect(modelPrice("openai", "some-future-model")).toBeNull();
    expect(callCost("openai", "some-future-model", 1, 1)).toBeNull();
  });

  it("prices a call per million tokens", () => {
    // 1,000,000 in at $1 + 200,000 out at $5.
    expect(callCost("openai", "gpt-6.1-terra", 1e6, 2e5)).toBeCloseTo(2);
  });

  it.each([
    [0, "$0"],
    [0.0004, "< $0.001"],
    [0.0123, "$0.012"],
    [1.5, "$1.50"],
  ])("formats %f as %s", (usd, label) => {
    expect(formatCost(usd)).toBe(label);
  });
});

describe("step ceilings", () => {
  it("adds the step's instructions to the source text", () => {
    expect(stepCeiling("job", 4000)).toEqual({
      inputTokens: STEPS.job.overhead + 1000,
      outputTokens: STEPS.job.maxOutput,
    });
  });

  it("counts every turn the analysis agent may take", () => {
    const one = STEPS.analysis.overhead + 1000;
    expect(stepCeiling("analysis", 4000)).toEqual({
      inputTokens: STEPS.analysis.maxTurns * one,
      outputTokens: STEPS.analysis.maxTurns * STEPS.analysis.maxOutput,
    });
  });
});

describe("session usage", () => {
  it("totals calls and keeps unpriced ones separate", () => {
    let total = addUsage(emptyUsage, {
      provider: "openai",
      model: "gpt-6.1-terra",
      inputTokens: 1000,
      outputTokens: 500,
    });
    total = addUsage(total, { inputTokens: 10, outputTokens: 10 });
    expect(total).toEqual({
      calls: 2,
      inputTokens: 1010,
      outputTokens: 510,
      cost: (1000 * 1 + 500 * 5) / 1e6,
      unpriced: 1,
    });
  });

  it("labels a finished call", () => {
    expect(
      usageLabel({
        provider: "openai",
        model: "gpt-6.1-terra",
        inputTokens: 1240,
        outputTokens: 610,
      }),
    ).toBe("1,240 in / 610 out tokens · ≈ $0.004");
    expect(
      usageLabel({
        provider: "ollama",
        model: "qwen3:8b",
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).toBe("1 in / 1 out tokens · no API cost");
  });
});

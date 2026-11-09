import { afterEach, expect, it, vi } from "vitest";
import {
  emptyProgress,
  planSources,
  validateProgress,
} from "../lib/preparation-plan";
import { reviewNotes } from "../lib/notes-review";
import { target, version, workspace } from "./preparation-fixtures";

const plan = async () => version(await planSources(target, workspace()));
const feedback = {
  strength: "Names the rollout",
  improvement: "Add the outcome you measured",
  caution: "",
  answerQuote: "led the rollout",
};
const config = {
  provider: "ollama" as const,
  model: "qwen3:8b",
  deadlineMs: 1000,
};
const reply = (output: unknown) =>
  vi.fn(async () =>
    Response.json({
      message: { content: JSON.stringify(output) },
      done: true,
      prompt_eval_count: 80,
      eval_count: 40,
    }),
  );
afterEach(() => vi.unstubAllGlobals());

it("reviews notes once and returns feedback with the notes it reviewed", async () => {
  const fetcher = reply(feedback);
  vi.stubGlobal("fetch", fetcher);
  const p = await plan();
  const result = await reviewNotes(p, "q1", "I led the rollout.", config);
  expect(result).toMatchObject({ notes: "I led the rollout.", feedback });
  expect(result.metadata.inputTokens).toBe(80);
  expect(fetcher).toHaveBeenCalledOnce();
  // The stored review passes progress validation for its question only.
  const progress = { ...emptyProgress(p.id), reviews: { q1: result } };
  expect(validateProgress(progress, p).reviews?.q1.feedback).toEqual(feedback);
  expect(() =>
    validateProgress({ ...progress, reviews: { nope: result } }, p),
  ).toThrow();
});

it("rejects a quote that is not in the notes, without retrying", async () => {
  const fetcher = reply({ ...feedback, answerQuote: "invented metric" });
  vi.stubGlobal("fetch", fetcher);
  await expect(
    reviewNotes(await plan(), "q1", "I led the rollout.", config),
  ).rejects.toMatchObject({ code: "notes_invalid_output" });
  expect(fetcher).toHaveBeenCalledOnce();
});

it("refuses unknown questions and empty notes before any call", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const p = await plan();
  await expect(
    reviewNotes(p, "missing", "notes", config),
  ).rejects.toMatchObject({ code: "notes_question" });
  await expect(reviewNotes(p, "q1", "   ", config)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

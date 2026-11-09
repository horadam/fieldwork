// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PlanPractice } from "../../components/preparation/plan-practice";
import { emptyProgress, planSources } from "../../lib/preparation-plan";
import { target, version, workspace } from "../preparation-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const ai = { provider: "ollama", model: "qwen3:8b", ready: true } as never;

it("reviews notes on request and keeps the result beside self-scores", async () => {
  const plan = version(await planSources(target, workspace()));
  const review = {
    notes: "I shipped the form.",
    feedback: {
      strength: "Names what shipped",
      improvement: "Say what you owned",
      caution: "",
      answerQuote: "",
    },
    metadata: {
      provider: "ollama",
      model: "qwen3:8b",
      promptVersion: "notes-review-v1",
      durationMs: 5,
      inputTokens: 10,
      outputTokens: 5,
    },
    reviewedAt: new Date().toISOString(),
  };
  const fetcher = vi.fn(async () => Response.json(review));
  vi.stubGlobal("fetch", fetcher);
  const onChange = vi.fn(),
    onReview = vi.fn();
  const props = {
    plan,
    questionId: "q1",
    onQuestion: () => {},
    readOnly: false,
    saveStatus: "",
    onChange,
    onReview,
    token: "",
    ai,
  };
  const empty = emptyProgress(plan.id);
  const view = render(<PlanPractice {...props} progress={empty} />);
  expect(
    (
      screen.getByRole("button", {
        name: "Review my notes",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  const progress = { ...empty, answers: { q1: "I shipped the form." } };
  view.rerender(<PlanPractice {...props} progress={progress} />);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review my notes" }));
  await waitFor(() => expect(onReview).toHaveBeenCalledOnce());
  expect(fetcher).toHaveBeenCalledOnce();
  // Only the review is handed back, never a whole progress object captured
  // when the review started, so edits made meanwhile can't be overwritten.
  expect(onChange).not.toHaveBeenCalled();
  expect(onReview.mock.calls[0][0]).toBe("q1");
  expect(onReview.mock.calls[0][1].feedback.strength).toBe(
    "Names what shipped",
  );
  const saved = { ...progress, reviews: { q1: onReview.mock.calls[0][1] } };
  view.rerender(
    <PlanPractice
      {...props}
      progress={{ ...saved, answers: { q1: "I shipped and owned the form." } }}
    />,
  );
  screen.getByText("Names what shipped");
  screen.getByText("Notes changed since this review");
  screen.getByRole("button", { name: "Review again" });
});

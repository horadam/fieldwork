// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { InterviewSession } from "../../components/preparation/interview-session";
import { planSources } from "../../lib/preparation-plan";
import { newSession, advanceSession } from "../../lib/practice-session";
import { target, version, workspace } from "../preparation-fixtures";
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
it("starts without inference, retains failed answers, and saves an attempt", async () => {
  const plan = version(await planSources(target, workspace()));
  const fetcher = vi.fn(async () =>
    Response.json({ error: "Ollama unavailable" }, { status: 503 }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(
    <InterviewSession
      plan={plan}
      token=""
      questionIds={["q1"]}
      activityId="a1"
      readOnly={false}
      ai={{ provider: "ollama", model: "qwen3:8b", ready: true } as never}
      onComplete={() => {}}
      activityDone={false}
    />,
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Start this question",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start this question" }));
  const answer = await screen.findByLabelText("Your interview answer");
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(answer, { target: { value: "Built an accessible form" } });
  fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
  await screen.findByRole("alert");
  expect((answer as HTMLTextAreaElement).value).toBe(
    "Built an accessible form",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "End interview and review" }),
  );
  await screen.findByText("Session complete");
  expect(
    JSON.parse(localStorage.getItem("fieldwork-interviews-v1")!)[0].status,
  ).toBe("completed");
});
it("does not show interview feedback until the end", async () => {
  const plan = version(await planSources(target, workspace()));
  let s = newSession(plan, ["q1"], "interview");
  s = advanceSession(
    plan,
    s,
    {
      id: crypto.randomUUID(),
      questionId: "q1",
      prompt: s.prompt,
      answer: "An answer",
      feedback: {
        strength: "Specific hidden feedback",
        improvement: "Explain a tradeoff",
        caution: "",
        answerQuote: "",
      },
      metadata: {
        provider: "ollama",
        model: "test",
        promptVersion: "test",
        durationMs: 1,
        inputTokens: 1,
        outputTokens: 1,
      },
    },
    "What was yours?",
  );
  localStorage.setItem("fieldwork-interviews-v1", JSON.stringify([s]));
  render(
    <InterviewSession
      plan={plan}
      token=""
      questionIds={["q1"]}
      activityId={null}
      readOnly={false}
      ai={{ ready: true } as never}
      onComplete={() => {}}
      activityDone={false}
    />,
  );
  fireEvent.change(await screen.findByLabelText("Attempt history"), {
    target: { value: s.id },
  });
  expect(screen.queryByText("Specific hidden feedback")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "End interview and review" }),
  );
  await screen.findByText("Specific hidden feedback");
});

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
      scope="browser"
      questionIds={["q1"]}
      activityId="a1"
      readOnly={false}
      ai={{ provider: "ollama", model: "qwen3:8b", ready: true } as never}
      onComplete={() => {}}
      completedActivities={{}}
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
  // The question to be asked is visible, and can be changed, before starting.
  const picker = screen.getByLabelText("Question") as HTMLSelectElement;
  expect(picker.value).toBe("q1");
  fireEvent.click(screen.getByRole("button", { name: "Start this question" }));
  const answer = await screen.findByLabelText("Your interview answer");
  // Starting moves keyboard focus into the answer box.
  await waitFor(() => expect(document.activeElement).toBe(answer));
  expect(fetcher).not.toHaveBeenCalled();
  const meta = document.querySelector(".interview-session .meta");
  expect(meta?.textContent).toContain("Coach mode");
  expect(meta?.textContent).toContain("1 question");
  // The practice cost belongs to Send answer, after the voice panel.
  const voice = document.querySelector(".voice-answer")!,
    cost = document.querySelector(".cost-hint")!;
  expect(
    voice.compareDocumentPosition(cost) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.change(answer, { target: { value: "Built an accessible form" } });
  fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
  await screen.findByRole("alert");
  expect((answer as HTMLTextAreaElement).value).toBe(
    "Built an accessible form",
  );
  // An unsent draft is never dropped without asking.
  const confirm = vi.fn(() => false);
  vi.stubGlobal("confirm", confirm);
  fireEvent.click(
    screen.getByRole("button", { name: "End interview and review" }),
  );
  expect(confirm).toHaveBeenCalledOnce();
  expect((answer as HTMLTextAreaElement).value).toBe(
    "Built an accessible form",
  );
  confirm.mockReturnValue(true);
  fireEvent.click(
    screen.getByRole("button", { name: "End interview and review" }),
  );
  await screen.findByRole("button", { name: "Try another attempt" });
  expect(
    JSON.parse(localStorage.getItem("fieldwork-interviews-v1-browser")!)[0]
      .status,
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
      scope="browser"
      questionIds={["q1"]}
      activityId={null}
      readOnly={false}
      ai={{ ready: true } as never}
      onComplete={() => {}}
      completedActivities={{}}
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

it("saves a successful reply once and offers explicit rehearsal completion", async () => {
  const plan = version(await planSources(target, workspace())),
    complete = vi.fn();
  const fetcher = vi.fn(
    async (_url: unknown, init: RequestInit | undefined) => {
      const { session, answer } = JSON.parse(String(init?.body));
      const next = advanceSession(
        plan,
        session,
        {
          id: crypto.randomUUID(),
          questionId: "q1",
          prompt: session.prompt,
          answer,
          feedback: {
            strength: "Clear personal scope",
            improvement: "Explain the alternative",
            caution: "",
            answerQuote: answer,
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
        null,
      );
      return Response.json({ session: next });
    },
  );
  vi.stubGlobal("fetch", fetcher);
  render(
    <InterviewSession
      plan={plan}
      token=""
      scope="browser"
      questionIds={["q1"]}
      activityId="a1"
      readOnly={false}
      ai={{ provider: "ollama", ready: true } as never}
      onComplete={complete}
      completedActivities={{}}
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
  fireEvent.change(await screen.findByLabelText("Your interview answer"), {
    target: { value: "I built a form" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
  await screen.findByText("Clear personal scope");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(complete).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Mark linked rehearsal complete" }),
  );
  expect(complete).toHaveBeenCalledWith("a1");
  const stored = JSON.parse(
    localStorage.getItem("fieldwork-interviews-v1-browser")!,
  );
  expect(stored).toHaveLength(1);
  expect(stored[0].turns).toHaveLength(1);
});

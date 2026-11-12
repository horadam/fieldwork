import { afterEach, it, expect, vi } from "vitest";
import { generatePreparation } from "../lib/preparation-generation";
import { planSources } from "../lib/preparation-plan";
import {
  target,
  workspace,
  output,
  modelReply,
  settings,
} from "./preparation-fixtures";
const config = {
  provider: "ollama" as const,
  model: "qwen3:8b",
  deadlineMs: 180000,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("uses one native local structured call with no tools, downloads, or cloud fallback", async () => {
  const sources = await planSources(target, workspace());
  const fetcher = vi.fn(async () =>
    Response.json({
      message: { content: JSON.stringify(modelReply()) },
      done: true,
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await generatePreparation(sources, settings, config);
  expect(result.metadata.provider).toBe("ollama");
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://127.0.0.1:11434/api/chat");
  const body = JSON.parse(init.body as string);
  expect(body.format.type).toBe("object");
  expect(body.think).toBe(false);
  expect(body.tools).toBeUndefined();
  const user = JSON.parse(body.messages[1].content);
  expect(user.availableMinutes).toBe(720);
  expect(user.sources[0].evidenceSnapshot[0].id).toBe("e1");
  expect(user.sources[0].jdSnapshot).toBeUndefined();
  expect(body.messages[0].content).toContain("untrusted");
});
it("rejects oversized sources before any provider request, without truncation", async () => {
  const sources = await planSources(target, workspace());
  sources[0].analysis.summary = "x".repeat(60001);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(generatePreparation(sources, settings, config)).rejects.toThrow(
    "Nothing was truncated",
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  "invalid JSON",
  "invalid reference",
  "truncated",
  "offline",
  "missing model",
])("fails on %s without retries or fallback", async (mode) => {
  const sources = await planSources(target, workspace());
  // Every link invented: nothing usable is left to repair.
  const bad = modelReply();
  for (const item of [...bad.questions, ...bad.activities])
    item.refs = ["invented#r1"];
  const fetcher = vi.fn(async () => {
    if (mode === "offline") throw new Error("private diagnostic");
    if (mode === "missing model") return new Response("", { status: 404 });
    return Response.json(
      mode === "truncated"
        ? { done_reason: "length" }
        : {
            message: {
              content: mode === "invalid JSON" ? "bad" : JSON.stringify(bad),
            },
          },
    );
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(
    generatePreparation(sources, settings, config),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("cancels at the deadline while preserving the active plan contract", async () => {
  const sources = await planSources(target, workspace());
  const fetcher = vi.fn(
    async (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () => reject(new Error("abort"))),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    generatePreparation(sources, settings, { ...config, deadlineMs: 10 }),
  ).rejects.toThrow("active plan is unchanged");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("propagates caller cancellation with no retry", async () => {
  const sources = await planSources(target, workspace());
  const controller = new AbortController();
  controller.abort();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      expect(init.signal.aborted).toBe(true);
      throw new Error("abort");
    }),
  );
  await expect(
    generatePreparation(sources, settings, config, controller.signal),
  ).rejects.toThrow("cancelled");
});
it("preserves OpenAI as an explicit single structured-output request", async () => {
  const sources = await planSources(target, workspace());
  vi.stubEnv("OPENAI_API_KEY", "synthetic");
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    expect(JSON.parse(init.body as string).response_format.type).toBe(
      "json_schema",
    );
    return Response.json({
      id: "test",
      object: "chat.completion",
      created: 1,
      model: "test",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: JSON.stringify(modelReply()) },
        },
      ],
    });
  });
  vi.stubGlobal("fetch", fetcher);
  await generatePreparation(sources, settings, {
    provider: "openai",
    model: "test",
    deadlineMs: 45000,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://api.openai.com/v1/chat/completions",
  );
});
it("sends the link keys and reports repairs with the draft", async () => {
  const sources = await planSources(target, workspace());
  const reply = modelReply();
  reply.questions[0].evidenceRefs.push("job-a#e9");
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({ message: { content: JSON.stringify(reply) }, done: true }),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await generatePreparation(sources, settings, config);
  const user = JSON.parse(
    JSON.parse(fetcher.mock.calls[0][1].body as string).messages[1].content,
  );
  expect(user.linkKeys.evidence).toEqual(["job-a#e1"]);
  expect(result.output).toEqual(output());
  expect(result.metadata.repairs).toEqual([
    "Removed 1 experience link the analysis didn't cite for that job.",
  ]);
  expect(result.metadata.promptVersion).toBe("preparation-v3");
});
it("names the reason when a plan can't be used", async () => {
  const sources = await planSources(target, workspace());
  const reply = modelReply();
  reply.questions[0].refs = ["invented#r1"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        message: { content: JSON.stringify(reply) },
        done: true,
      }),
    ),
  );
  await expect(
    generatePreparation(sources, settings, config),
  ).rejects.toMatchObject({
    code: "preparation_invalid_output",
    message: expect.stringContaining(
      "no question was linked to a real requirement",
    ),
  });
});

it("adds a disclosed rehearsal when a generated plan omits question practice", async () => {
  const sources = await planSources(target, workspace()),
    reply = modelReply();
  reply.activities = reply.activities.filter(
    (a) => a.type !== "question_practice",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        message: { content: JSON.stringify(reply) },
        done: true,
      }),
    ),
  );
  const result = await generatePreparation(sources, settings, config);
  expect(
    result.output.activities.some(
      (a) => a.type === "question_practice" && a.questionIds.includes("q1"),
    ),
  ).toBe(true);
  expect(result.metadata.repairs.join(" ")).toContain(
    "Added a 15-minute rehearsal",
  );
});

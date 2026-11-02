import { afterEach, describe, it, expect, vi } from "vitest";
import { analyze } from "../lib/agent";
import { extractResume } from "../lib/resume-extraction";
import { demoAnalysis, type Job } from "../lib/domain";
const job: Job = {
  id: "job",
  company: "Example",
  role: "Engineer",
  jd: "Build React interfaces and maintain Node APIs.",
  stage: "Saved",
  notes: "",
};
const evidence = [
  {
    id: "e1",
    title: "React",
    body: "Built React interfaces with the product team.",
  },
];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("real SDK with mocked HTTP transport (no provider calls)", () => {
  it("runs Ollama JD analysis through Chat Completions, read-only tools, and structured output", async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const body = JSON.parse(init.body);
        requests.push({ url: String(url), body });
        const first = requests.length === 1;
        const message = first
          ? {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "j",
                  type: "function",
                  function: { name: "read_selected_job", arguments: "{}" },
                },
                {
                  id: "e",
                  type: "function",
                  function: {
                    name: "read_verified_experience",
                    arguments: "{}",
                  },
                },
              ],
            }
          : {
              role: "assistant",
              content: JSON.stringify(demoAnalysis(job, evidence)),
            };
        return Response.json({
          id: `chat-${requests.length}`,
          object: "chat.completion",
          created: 1,
          model: "qwen3:8b",
          choices: [
            { index: 0, message, finish_reason: first ? "tool_calls" : "stop" },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        });
      }),
    );
    const result = await analyze(job.jd, evidence, "qwen3:8b", "grounded", {
      provider: "ollama",
      model: "qwen3:8b",
      deadlineMs: 180000,
    });
    expect(result.toolCalls).toBe(2);
    expect(result.output.tasks.length).toBeGreaterThan(0);
    expect(requests).toHaveLength(2);
    expect(
      requests.every(
        (r) => r.url === "http://127.0.0.1:11434/v1/chat/completions",
      ),
    ).toBe(true);
    expect(requests[0].body.reasoning_effort).toBe("none");
    expect((requests[0].body.response_format as { type: string }).type).toBe(
      "json_schema",
    );
    expect(requests[0].body.tools as unknown[]).toHaveLength(2);
    expect(JSON.stringify(requests[1].body.messages)).toContain(
      "Built React interfaces",
    );
  });
  it("does not retry a failed OpenAI SDK request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
    const fetcher = vi.fn(async () =>
      Response.json(
        { error: { message: "test failure", type: "server_error" } },
        { status: 500 },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      analyze(job.jd, evidence, "test", "grounded", {
        provider: "openai",
        model: "test",
        deadlineMs: 45000,
      }),
    ).rejects.toThrow("No automatic retry");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserves OpenAI structured extraction as a single opt-in call", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(init.body as string);
      expect(payload.response_format.type).toBe("json_schema");
      expect(payload.tools).toBeUndefined();
      return Response.json({
        id: "test",
        object: "chat.completion",
        created: 1,
        model: "test",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                drafts: [],
                warnings: ["No roles found."],
              }),
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await extractResume(
      {
        text: "Skills: React, TypeScript and Node. No roles listed.",
        pages: [],
      },
      { provider: "openai", model: "test", deadlineMs: 45000 },
    );
    expect(result.drafts).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });
});

it("analyzes a local response without tool calls using sources supplied in the first request", async () => {
  const out = demoAnalysis(job, evidence);
  out.summary = "Assessment of the selected role";
  out.requirements[0].status = "supported";
  out.requirements[0].evidenceIds = ["e1"];
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const message = body.messages.find(
      (m: { role: string }) => m.role === "user",
    );
    expect(message.content).toContain(job.jd);
    expect(message.content).toContain(evidence[0].body);
    expect(message.content).toContain("e1");
    return Response.json({
      id: "one-pass",
      object: "chat.completion",
      created: 1,
      model: "qwen3:8b",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(out) },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 200, completion_tokens: 150, total_tokens: 350 },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await analyze(job.jd, evidence, "qwen3:8b", "grounded", {
    provider: "ollama",
    model: "qwen3:8b",
    deadlineMs: 180000,
  });
  expect(result.output.requirements[0].evidenceIds).toEqual(["e1"]);
  expect(result.toolCalls).toBe(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects invented evidence IDs with a validation-specific error and no retry", async () => {
  const out = demoAnalysis(job, evidence);
  out.requirements[0].status = "supported";
  out.requirements[0].evidenceIds = ["invented-id"];
  const fetcher = vi.fn(async () =>
    Response.json({
      id: "bad-ref",
      object: "chat.completion",
      created: 1,
      model: "qwen3:8b",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(out) },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 200, completion_tokens: 150, total_tokens: 350 },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const error = await analyze(job.jd, evidence, "qwen3:8b", "grounded", {
    provider: "ollama",
    model: "qwen3:8b",
    deadlineMs: 180000,
  }).catch((e) => e);
  expect(error.code).toBe("analysis_invalid_output");
  expect(error.message).toContain("Unknown evidence reference");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("reports SDK JSON parse failures without exposing model text", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        id: "bad-json",
        object: "chat.completion",
        created: 1,
        model: "qwen3:8b",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "PRIVATE_NOT_JSON" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 150,
          total_tokens: 350,
        },
      }),
    ),
  );
  const error = await analyze(job.jd, evidence, "qwen3:8b", "grounded", {
    provider: "ollama",
    model: "qwen3:8b",
    deadlineMs: 180000,
  }).catch((e) => e);
  expect(error.code).toBe("analysis_invalid_response");
  expect(error.message).not.toContain("PRIVATE_NOT_JSON");
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AIError } from "../lib/ai-provider";
import { structuredCompletion } from "../lib/model-call";

const ollama = {
  provider: "ollama" as const,
  model: "qwen3:8b",
  deadlineMs: 180000,
};
const openai = {
  provider: "openai" as const,
  model: "test",
  deadlineMs: 45000,
};
const schema = z.object({ answer: z.string() });
function call(
  config: typeof ollama | typeof openai,
  extra: Partial<Parameters<typeof structuredCompletion>[0]> = {},
) {
  return structuredCompletion({
    config,
    flow: "demo",
    copy: {
      task: "demo task",
      kept: "Nothing changed.",
      shorten: "Shorten it.",
    },
    schema,
    schemaName: "demo",
    system: "System prompt",
    user: (jsonSchema) =>
      JSON.stringify({ text: "PRIVATE_SOURCE", jsonSchema }),
    maxTokens: 100,
    promptVersion: "demo-v1",
    validate: (raw) => schema.parse(raw),
    ...extra,
  });
}
const ollamaReply = (body: unknown, status = 200) =>
  vi.fn(async () => Response.json(body, { status }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("structuredCompletion", () => {
  it("records duration and Ollama token counts on success", async () => {
    const fetcher = ollamaReply({
      message: { content: '{"answer":"yes"}' },
      done: true,
      prompt_eval_count: 120,
      eval_count: 30,
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await call(ollama);
    expect(result.output).toEqual({ answer: "yes" });
    expect(result.metadata).toMatchObject({
      provider: "ollama",
      model: "qwen3:8b",
      promptVersion: "demo-v1",
      inputTokens: 120,
      outputTokens: 30,
    });
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
    const body = JSON.parse(
      (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    );
    expect(body.options.num_predict).toBe(100);
    expect(JSON.parse(body.messages[1].content).jsonSchema.type).toBe("object");
  });

  it("keeps usage on a failure after the model answered", async () => {
    vi.stubGlobal(
      "fetch",
      ollamaReply({
        message: { content: "not json" },
        prompt_eval_count: 50,
        eval_count: 5,
      }),
    );
    const error = (await call(ollama).catch((e) => e)) as AIError;
    expect(error.code).toBe("demo_invalid_json");
    expect(error.usage).toMatchObject({ inputTokens: 50, outputTokens: 5 });
    expect(error.message).not.toContain("PRIVATE_SOURCE");
  });

  it.each([
    [
      "an unexpected envelope",
      { content: "flat" },
      "invalid_provider_response",
    ],
    [
      "truncation without a message",
      { done_reason: "length" },
      "demo_truncated",
    ],
    ["empty content", { message: { content: "  " } }, "demo_empty_output"],
    [
      "fields failing validation",
      { message: { content: '{"answer":2}' } },
      "demo_invalid_output",
    ],
  ])("reports %s with one request", async (_name, reply, code) => {
    const fetcher = ollamaReply(reply);
    vi.stubGlobal("fetch", fetcher);
    expect(((await call(ollama).catch((e) => e)) as AIError).code).toBe(code);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("passes validation errors through with their own code", async () => {
    vi.stubGlobal(
      "fetch",
      ollamaReply({ message: { content: '{"answer":"x"}' } }),
    );
    const error = (await call(ollama, {
      validate: () => {
        throw new AIError("Too long.", "demo_too_long", 422);
      },
    }).catch((e) => e)) as AIError;
    expect(error).toMatchObject({ code: "demo_too_long", status: 422 });
    expect(error.message).toContain("No OpenAI request or fallback");
  });

  it("maps the deadline and caller cancellation to generic codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener("abort", () =>
              reject(init.signal!.reason),
            ),
          ),
      ),
    );
    const timeout = (await call({ ...ollama, deadlineMs: 20 }).catch(
      (e) => e,
    )) as AIError;
    expect(timeout).toMatchObject({ code: "inference_timeout", status: 504 });
    expect(timeout.usage!.durationMs).toBeGreaterThanOrEqual(15);
    const controller = new AbortController();
    const pending = call(ollama, { signal: controller.signal }).catch((e) => e);
    controller.abort();
    expect(await pending).toMatchObject({
      code: "inference_cancelled",
      status: 499,
    });
  });

  it("uses one OpenAI structured request with usage and no retry", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
    const fetcher = vi.fn(async () =>
      Response.json({
        id: "x",
        object: "chat.completion",
        created: 1,
        model: "test",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: '{"answer":"ok"}',
              refusal: null,
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await call(openai);
    expect(result.metadata).toMatchObject({ inputTokens: 11, outputTokens: 7 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports an OpenAI length stop as truncation", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id: "x",
          object: "chat.completion",
          created: 1,
          model: "test",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: '{"ans', refusal: null },
              finish_reason: "length",
            },
          ],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 100,
            total_tokens: 111,
          },
        }),
      ),
    );
    const error = (await call(openai).catch((e) => e)) as AIError;
    expect(error.code).toBe("demo_truncated");
    expect(error.usage!.outputTokens).toBe(100);
  });
});

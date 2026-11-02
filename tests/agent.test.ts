import { beforeEach, describe, it, expect, vi } from "vitest";
const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));
vi.mock("@openai/agents", () => ({
  Agent: class {
    constructor(public config: unknown) {}
  },
  Runner: class {
    run = mockRun;
  },
  OpenAIChatCompletionsModel: class {},
  OpenAIResponsesModel: class {},
  tool: (config: unknown) => config,
}));
import { analyze } from "../lib/agent";
import { seed } from "../lib/seed";
beforeEach(() => vi.resetAllMocks());
describe("agent failure boundaries", () => {
  it("propagates provider failure for the route to persist", async () => {
    mockRun.mockRejectedValue(new Error("provider unavailable"));
    await expect(
      analyze("React required", seed.experience, "test"),
    ).rejects.toThrow("provider");
  });
  it("rejects malformed model output", async () => {
    mockRun.mockResolvedValue({
      finalOutput: { oops: true },
      state: { usage: {} },
    });
    await expect(
      analyze("React required", seed.experience, "test"),
    ).rejects.toThrow();
  });
  it("bounds run turns and passes an abort signal", async () => {
    mockRun.mockRejectedValue(new Error("stop"));
    await expect(
      analyze("React required", seed.experience, "test"),
    ).rejects.toThrow();
    expect(mockRun.mock.calls[0][2].maxTurns).toBe(6);
    expect(mockRun.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
  });
  it("aborts at the deadline", async () => {
    vi.useFakeTimers();
    mockRun.mockImplementation(
      (_a, _b, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    );
    const pending = expect(
      analyze("React required", seed.experience, "test"),
    ).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(45000);
    await pending;
    vi.useRealTimers();
  });
});

it("gives local analysis 180 seconds rather than the OpenAI deadline", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  mockRun.mockImplementation(
    (_a, _b, options) =>
      new Promise((_resolve, reject) => {
        signal = options.signal;
        options.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  );
  const pending = expect(
    analyze("React required", seed.experience, "qwen3:8b", "grounded", {
      provider: "ollama",
      model: "qwen3:8b",
      deadlineMs: 180000,
    }),
  ).rejects.toThrow("Analysis timed out");
  await vi.advanceTimersByTimeAsync(45000);
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(135000);
  await pending;
  vi.useRealTimers();
});
it("stops tool retrieval after ten calls", async () => {
  mockRun.mockImplementation(async (agent) => {
    for (let i = 0; i < 11; i++) await agent.config.tools[0].execute({});
  });
  await expect(
    analyze("React required", seed.experience, "test"),
  ).rejects.toThrow("Tool budget");
});

it("passes Ollama the selected sources before any optional tool use", async () => {
  mockRun.mockRejectedValue(new Error("stop"));
  await expect(
    analyze("SELECTED_JOB", seed.experience, "test", "grounded", {
      provider: "ollama",
      model: "test",
      deadlineMs: 180000,
    }),
  ).rejects.toThrow();
  const input = JSON.parse(mockRun.mock.calls[0][1]);
  expect(input.jobDescription).toBe("SELECTED_JOB");
  expect(input.experience).toEqual(
    seed.experience.map(({ id, title, body }) => ({ id, title, body })),
  );
});
it.each(["ModelBehaviorError", "MaxTurnsExceededError"])(
  "sanitizes SDK %s errors without leaking source",
  async (name) => {
    mockRun.mockRejectedValue(
      Object.assign(new Error("PRIVATE_MODEL_OUTPUT"), { name }),
    );
    const error = await analyze(
      "Selected JD",
      seed.experience,
      "test",
      "grounded",
      { provider: "ollama", model: "test", deadlineMs: 180000 },
    ).catch((e) => e);
    expect(error.message).not.toContain("PRIVATE_MODEL_OUTPUT");
    expect(error.code).toBe(
      name === "ModelBehaviorError"
        ? "analysis_invalid_response"
        : "analysis_turn_limit",
    );
  },
);

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
import { providerConfig } from "../lib/ai-provider";
import { seed } from "../lib/seed";
const openai = {
  provider: "openai" as const,
  model: "test",
  deadlineMs: 45000,
};
const ollama45 = { ...openai, provider: "ollama" as const };
const ollama = {
  provider: "ollama" as const,
  model: "test",
  deadlineMs: 180000,
};
beforeEach(() => vi.resetAllMocks());
describe("agent failure boundaries", () => {
  it("propagates provider failure for the route to persist", async () => {
    mockRun.mockRejectedValue(new Error("provider unavailable"));
    await expect(
      analyze("React required", seed.experience, ollama45),
    ).rejects.toThrow("Local inference failed");
  });
  it("rejects malformed model output", async () => {
    mockRun.mockResolvedValue({
      finalOutput: { oops: true },
      state: { usage: {} },
    });
    await expect(
      analyze("React required", seed.experience, ollama45),
    ).rejects.toThrow();
  });
  it("bounds run turns and passes an abort signal", async () => {
    mockRun.mockRejectedValue(new Error("stop"));
    await expect(
      analyze("React required", seed.experience, ollama45),
    ).rejects.toThrow();
    expect(mockRun.mock.calls[0][2].maxTurns).toBe(6);
    expect(mockRun.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
  });
  it("aborts at the configured deadline and records the elapsed time", async () => {
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
    const error = await analyze("React required", seed.experience, {
      ...ollama,
      deadlineMs: 30,
    }).catch((e) => e);
    expect(signal?.aborted).toBe(true);
    expect(error.code).toBe("inference_timeout");
    expect(error.usage.durationMs).toBeGreaterThanOrEqual(25);
  });
});

it("gives local analysis 180 seconds rather than the OpenAI deadline", () => {
  vi.stubEnv("AI_PROVIDER", "ollama");
  expect(providerConfig().deadlineMs).toBe(180000);
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("OPENAI_MODEL", "test");
  expect(providerConfig().deadlineMs).toBe(45000);
  vi.unstubAllEnvs();
});
it("stops tool retrieval after ten calls", async () => {
  mockRun.mockImplementation(async (agent) => {
    for (let i = 0; i < 11; i++) await agent.config.tools[0].execute({});
  });
  await expect(
    analyze("React required", seed.experience, ollama45),
  ).rejects.toThrow("Local inference failed");
});

it("passes Ollama the selected sources before any optional tool use", async () => {
  mockRun.mockRejectedValue(new Error("stop"));
  await expect(
    analyze("SELECTED_JOB", seed.experience, ollama),
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
    const error = await analyze("Selected JD", seed.experience, ollama).catch(
      (e) => e,
    );
    expect(error.message).not.toContain("PRIVATE_MODEL_OUTPUT");
    expect(error.code).toBe(
      name === "ModelBehaviorError"
        ? "analysis_invalid_response"
        : "analysis_turn_limit",
    );
  },
);

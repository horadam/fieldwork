import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ authenticated: vi.fn(), analyze: vi.fn() }));
vi.mock("../lib/server", async (original) => ({
  ...(await original<typeof import("../lib/server")>()),
  authenticated: mocks.authenticated,
}));
vi.mock("../lib/agent", async (original) => ({
  ...(await original<typeof import("../lib/agent")>()),
  analyze: mocks.analyze,
}));
import { POST as analyze } from "../app/api/analyze/route";
import { AIError } from "../lib/ai-provider";
const id = "4b8954ca-4e61-4a04-838e-f145ba73422b";
const evidence = [{ id: "e1", title: "React", body: "Built React apps." }];
const output = {
  summary: "Fit",
  requirements: [
    {
      id: "r1",
      requirement: "React",
      status: "supported",
      explanation: "Direct",
      evidenceIds: ["e1"],
    },
  ],
  questions: [{ requirementId: "r1", question: "Tell me about React." }],
  tasks: [{ requirementId: "r1", title: "Review", detail: "Review hooks." }],
};
function req(body: unknown) {
  return new NextRequest("http://127.0.0.1:3000/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
function database(finishError: unknown = null) {
  const rpc = vi.fn(async (name: string, _args?: unknown) => {
    if (name === "start_analysis")
      return {
        data: {
          id,
          jd_snapshot: "Build React apps.",
          evidence_snapshot: evidence,
        },
        error: null,
      };
    if (name === "finish_analysis") return { data: null, error: finishError };
    return { data: null, error: null };
  });
  mocks.authenticated.mockResolvedValue({ user: { id: "owner" }, db: { rpc } });
  return rpc;
}
it("reports a failed result save as a storage error, not an inference failure", async () => {
  vi.stubEnv("AI_PROVIDER", "ollama");
  const rpc = database({ code: "XX000" });
  mocks.analyze.mockResolvedValue({
    output,
    metadata: { durationMs: 10, inputTokens: 1, outputTokens: 1 },
  });
  const response = await analyze(req({ applicationId: id }));
  expect(response.status).toBe(500);
  expect((await response.json()).error).toContain("could not be saved");
  // Only the success write ran; the run was not relabeled as a model error.
  expect(rpc.mock.calls.filter(([n]) => n === "finish_analysis")).toHaveLength(
    1,
  );
});
it("records a provider failure on the run and returns the sanitized diagnostic", async () => {
  vi.stubEnv("AI_PROVIDER", "ollama");
  const rpc = database();
  mocks.analyze.mockRejectedValue(new Error("socket hang up"));
  const response = await analyze(req({ applicationId: id }));
  expect(response.status).toBeGreaterThanOrEqual(500);
  const finish = rpc.mock.calls.find(([n]) => n === "finish_analysis");
  expect(finish?.[1]).toMatchObject({ p_output: null });
});
it("records the model's token usage when its output is rejected", async () => {
  vi.stubEnv("AI_PROVIDER", "ollama");
  const rpc = database();
  const rejected = new AIError("invalid", "analysis_invalid_output");
  rejected.usage = { durationMs: 1200, inputTokens: 300, outputTokens: 90 };
  mocks.analyze.mockRejectedValue(rejected);
  await analyze(req({ applicationId: id }));
  const finish = rpc.mock.calls.find(([n]) => n === "finish_analysis");
  expect(finish?.[1]).toMatchObject({
    p_duration: 1200,
    p_input: 300,
    p_output_tokens: 90,
  });
});

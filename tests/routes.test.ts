import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  authenticated: vi.fn(),
  inferenceAccess: vi.fn(),
  analyze: vi.fn(),
  extractResume: vi.fn(),
  providerStatus: vi.fn(),
}));
vi.mock("../lib/server", async (original) => ({
  ...(await original<typeof import("../lib/server")>()),
  authenticated: mocks.authenticated,
  inferenceAccess: mocks.inferenceAccess,
}));
vi.mock("../lib/agent", async (original) => ({
  ...(await original<typeof import("../lib/agent")>()),
  analyze: mocks.analyze,
}));
vi.mock("../lib/resume-extraction", async (original) => ({
  ...(await original<typeof import("../lib/resume-extraction")>()),
  extractResume: mocks.extractResume,
}));
vi.mock("../lib/ai-provider", async (original) => ({
  ...(await original<typeof import("../lib/ai-provider")>()),
  providerStatus: mocks.providerStatus,
}));
import { POST as analyzeLocal } from "../app/api/analyze/local/route";
import { POST as importExperience } from "../app/api/experience/import/route";
import { POST as extractResume } from "../app/api/resume/extract/route";
import { GET as status } from "../app/api/ai/status/route";
import { AIError } from "../lib/ai-provider";
import { HttpError } from "../lib/server";
import { loadPreparation, ownedTarget } from "../lib/preparation-server";

const post = (body: unknown) =>
  new NextRequest("http://127.0.0.1:3000/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
const jd = "Build accessible React interfaces with TypeScript.";
const experience = [{ id: "e1", title: "React", body: "Built React apps." }];

describe("local analysis route", () => {
  it("refuses signed-in callers, who must use account analysis", async () => {
    mocks.inferenceAccess.mockRejectedValue(new HttpError(403, "Use account"));
    expect((await analyzeLocal(post({ jd, experience }))).status).toBe(403);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("returns output with flat metadata the browser stores on the run", async () => {
    vi.stubEnv("AI_PROVIDER", "ollama");
    mocks.inferenceAccess.mockResolvedValue(null);
    mocks.analyze.mockResolvedValue({
      output: { summary: "s" },
      metadata: { provider: "ollama", durationMs: 9, inputTokens: 3 },
    });
    const body = await (await analyzeLocal(post({ jd, experience }))).json();
    expect(body).toMatchObject({
      output: { summary: "s" },
      provider: "ollama",
      durationMs: 9,
      inputTokens: 3,
    });
  });
  it("reports the model's usage when a run fails after it answered", async () => {
    vi.stubEnv("AI_PROVIDER", "ollama");
    mocks.inferenceAccess.mockResolvedValue(null);
    const error = new AIError("Rejected", "analysis_invalid_output");
    error.usage = { durationMs: 700, inputTokens: 10, outputTokens: 4 };
    mocks.analyze.mockRejectedValue(error);
    const response = await analyzeLocal(post({ jd, experience }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: "analysis_invalid_output",
      durationMs: 700,
      outputTokens: 4,
    });
  });
  it("rejects an over-long JD before any model call", async () => {
    mocks.inferenceAccess.mockResolvedValue(null);
    const response = await analyzeLocal(
      post({ jd: "x".repeat(15001), experience }),
    );
    expect(response.status).toBe(400);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
});

describe("resume extraction route", () => {
  it("spends the hosted quota, then returns drafts with metadata", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    mocks.inferenceAccess.mockResolvedValue({ db: { rpc } });
    mocks.extractResume.mockResolvedValue({
      output: { drafts: [], warnings: [] },
      metadata: { provider: "openai", inputTokens: 1 },
    });
    const response = await extractResume(
      post({
        text: "Acme\nEngineer\nBuilt React interfaces for support.",
        pages: [],
      }),
    );
    expect(rpc).toHaveBeenCalledWith("reserve_inference", {
      p_kind: "resume_extraction",
    });
    expect(await response.json()).toMatchObject({
      drafts: [],
      metadata: { inputTokens: 1 },
    });
  });
});

describe("experience import route", () => {
  it("saves a confirmed batch through the idempotent import function", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    mocks.authenticated.mockResolvedValue({ db: { rpc } });
    const batch = {
      batchId: "22222222-2222-4222-8222-222222222222",
      entries: [
        {
          itemId: "11111111-1111-4111-8111-111111111111",
          title: "Acme · Engineer",
          body: "Built React interfaces.",
          provenance: {
            kind: "role",
            organization: "Acme",
            role: "Engineer",
            dates: "",
            provider: "ollama",
            model: "qwen3:8b",
            promptVersion: "resume-v3",
            confirmedAt: "2026-11-02T10:00:00.000Z",
          },
        },
      ],
    };
    expect((await importExperience(post(batch))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("import_resume_experience", {
      p_batch_id: batch.batchId,
      p_entries: batch.entries,
    });
  });
  it("reports a failed import without partial saves", async () => {
    mocks.authenticated.mockResolvedValue({
      db: { rpc: async () => ({ data: null, error: { message: "cap" } }) },
    });
    const response = await importExperience(
      post({ batchId: "22222222-2222-4222-8222-222222222222", entries: [] }),
    );
    expect(response.status).toBe(400);
  });
});

describe("model status route", () => {
  it("never checks the model for callers without access", async () => {
    vi.stubEnv("AI_PROVIDER", "ollama");
    mocks.inferenceAccess.mockRejectedValue(new HttpError(403, "no"));
    const body = await (
      await status(new NextRequest("http://127.0.0.1:3000/api/ai/status"))
    ).json();
    expect(body).toMatchObject({ allowed: false, ready: false });
    expect(mocks.providerStatus).not.toHaveBeenCalled();
  });
  it("reports readiness for allowed callers", async () => {
    vi.stubEnv("AI_PROVIDER", "ollama");
    mocks.inferenceAccess.mockResolvedValue(null);
    mocks.providerStatus.mockResolvedValue({
      provider: "ollama",
      model: "qwen3:8b",
      ready: true,
      message: "ok",
    });
    const response = await status(
      new NextRequest("http://127.0.0.1:3000/api/ai/status"),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ allowed: true, ready: true });
  });
});

describe("preparation server loaders", () => {
  it("asks for migration 004 when preparation tables are missing", async () => {
    const db = {
      from: () => ({
        select: async () => ({ data: null, error: { code: "42P01" } }),
      }),
    };
    await expect(loadPreparation(db as never)).rejects.toMatchObject({
      status: 503,
    });
  });
  it("treats another user's or a missing target as not found", async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: null, error: {} }) }),
        }),
      }),
    };
    await expect(ownedTarget(db as never, "t")).rejects.toMatchObject({
      status: 404,
    });
  });
});

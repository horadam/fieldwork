import { afterEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  authenticated: vi.fn(),
  inferenceAccess: vi.fn(),
  ownedTarget: vi.fn(),
  loadSources: vi.fn(),
  loadPreparation: vi.fn(),
  generatePreparation: vi.fn(),
}));
vi.mock("../lib/server", async (original) => ({
  ...(await original<typeof import("../lib/server")>()),
  authenticated: mocks.authenticated,
  inferenceAccess: mocks.inferenceAccess,
}));
vi.mock("../lib/preparation-server", () => ({
  ownedTarget: mocks.ownedTarget,
  loadSources: mocks.loadSources,
  loadPreparation: mocks.loadPreparation,
}));
vi.mock("../lib/preparation-generation", () => ({
  generatePreparation: mocks.generatePreparation,
}));
import { POST as generate } from "../app/api/preparation/generate/route";
import { POST as mutate, GET as load } from "../app/api/preparation/route";
import { HttpError } from "../lib/server";
import { planSources } from "../lib/preparation-plan";
import {
  target,
  settings,
  workspace,
  output,
  metadata,
  version,
} from "./preparation-fixtures";
function req(value: unknown) {
  return new NextRequest("http://127.0.0.1:3000/api/preparation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
it("checks access before processing a generation request", async () => {
  mocks.inferenceAccess.mockRejectedValue(new HttpError(403, "Access denied"));
  expect((await generate(req({}))).status).toBe(403);
  expect(mocks.generatePreparation).not.toHaveBeenCalled();
});
it("accepts bounded local source snapshots with a current real analysis", async () => {
  vi.stubEnv("AI_PROVIDER", "ollama");
  mocks.inferenceAccess.mockResolvedValue(null);
  mocks.generatePreparation.mockResolvedValue({ output: output(), metadata });
  const response = await generate(
    req({ targetId: target.id, target, settings, workspace: workspace() }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.generatePreparation).toHaveBeenCalledTimes(1);
});
it("rejects malformed local source snapshots before any provider request", async () => {
  mocks.inferenceAccess.mockResolvedValue(null);
  const data = { ...workspace(), runs: ["not a run"] };
  expect(
    (
      await generate(
        req({ targetId: target.id, target, settings, workspace: data }),
      )
    ).status,
  ).toBe(400);
  expect(mocks.generatePreparation).not.toHaveBeenCalled();
});
it("rejects stale local inputs without a provider request", async () => {
  mocks.inferenceAccess.mockResolvedValue(null);
  const data = workspace();
  data.jobs[0].jd += " Extra expectations";
  expect(
    (
      await generate(
        req({ targetId: target.id, target, settings, workspace: data }),
      )
    ).status,
  ).toBe(400);
  expect(mocks.generatePreparation).not.toHaveBeenCalled();
});
it("reports an unexpected generation failure as a server error, not stale sources", async () => {
  vi.stubEnv("AI_PROVIDER", "ollama");
  mocks.inferenceAccess.mockResolvedValue(null);
  mocks.generatePreparation.mockRejectedValue(new TypeError("boom"));
  const response = await generate(
    req({ targetId: target.id, target, settings, workspace: workspace() }),
  );
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain("outdated");
});
it("loads authenticated sources server-side and ignores forged browser snapshots", async () => {
  vi.stubEnv("AI_PROVIDER", "ollama");
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  mocks.inferenceAccess.mockResolvedValue({ db: { rpc } });
  mocks.ownedTarget.mockResolvedValue(target);
  mocks.loadSources.mockResolvedValue(workspace());
  mocks.generatePreparation.mockResolvedValue({ output: output(), metadata });
  const response = await generate(
    req({
      targetId: target.id,
      settings,
      target: { ...target, name: "Forged" },
      workspace: { jobs: [] },
    }),
  );
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith("reserve_inference", {
    p_kind: "preparation_generation",
  });
  expect(mocks.loadSources).toHaveBeenCalled();
  const sources = mocks.generatePreparation.mock.calls[0][0];
  expect(sources[0].company).toBe("Example");
});
it("refuses a hosted generation over the hourly quota without a model call", async () => {
  mocks.inferenceAccess.mockResolvedValue({
    db: {
      rpc: async () => ({
        data: null,
        error: {
          message: "Hourly inference limit reached; retry in 12 minutes",
        },
      }),
    },
  });
  mocks.ownedTarget.mockResolvedValue(target);
  mocks.loadSources.mockResolvedValue(workspace());
  const response = await generate(req({ targetId: target.id, settings }));
  expect(response.status).toBe(429);
  expect((await response.json()).error).toContain("Try again in 12 minutes.");
  expect(mocks.generatePreparation).not.toHaveBeenCalled();
});
it("rejects invalid settings before loading sources or making a provider call", async () => {
  mocks.inferenceAccess.mockResolvedValue(null);
  expect(
    (
      await generate(
        req({
          targetId: target.id,
          target,
          settings: { ...settings, hoursPerWeek: 0 },
          workspace: workspace(),
        }),
      )
    ).status,
  ).toBe(400);
  expect(mocks.generatePreparation).not.toHaveBeenCalled();
});
it("loads saved data only through authenticated access", async () => {
  mocks.authenticated.mockRejectedValue(new HttpError(401, "Sign in"));
  expect((await load(req({}))).status).toBe(401);
  expect(mocks.loadPreparation).not.toHaveBeenCalled();
});
it("does not activate a plan if source data changed during review", async () => {
  const plan = version(await planSources(target, workspace()));
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }),
    rpc: vi.fn(),
  };
  mocks.authenticated.mockResolvedValue({ db });
  mocks.ownedTarget.mockResolvedValue(target);
  const changed = workspace();
  changed.experience[0].body += " Changed";
  mocks.loadSources.mockResolvedValue(changed);
  expect(
    (await mutate(req({ action: "activate", value: plan }))).status,
  ).not.toBe(200);
  expect(db.rpc).not.toHaveBeenCalled();
});
it("accepts an owned activation retry without requiring deleted source analyses", async () => {
  const plan = version(await planSources(target, workspace()));
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: plan.id }, error: null }),
          }),
        }),
      }),
    }),
    rpc: vi.fn(async () => ({ error: null })),
  };
  mocks.authenticated.mockResolvedValue({ db });
  mocks.ownedTarget.mockResolvedValue(target);
  expect((await mutate(req({ action: "activate", value: plan }))).status).toBe(
    200,
  );
  expect(mocks.loadSources).not.toHaveBeenCalled();
  expect(db.rpc).toHaveBeenCalledTimes(1);
});
it("rejects historical progress writes before calling the transaction", async () => {
  const plan = version(await planSources(target, workspace()));
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { payload: plan, target_id: target.id },
            error: null,
          }),
        }),
      }),
    }),
    rpc: vi.fn(),
  };
  mocks.authenticated.mockResolvedValue({ db });
  mocks.ownedTarget.mockResolvedValue({
    ...target,
    activeVersionId: "b2222222-2222-4222-8222-222222222222",
  });
  expect(
    (
      await mutate(
        req({
          action: "progress",
          value: { planId: plan.id, answers: {}, scores: {}, done: {} },
        }),
      )
    ).status,
  ).toBe(409);
  expect(db.rpc).not.toHaveBeenCalled();
});

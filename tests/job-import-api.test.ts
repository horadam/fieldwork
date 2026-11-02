import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  authenticated: vi.fn(),
  inferenceAccess: vi.fn(),
  fetchJobPage: vi.fn(),
  extractJob: vi.fn(),
}));
vi.mock("../lib/server", async (original) => ({
  ...(await original<typeof import("../lib/server")>()),
  authenticated: mocks.authenticated,
  inferenceAccess: mocks.inferenceAccess,
}));
vi.mock("../lib/job-page", async (original) => ({
  ...(await original<typeof import("../lib/job-page")>()),
  fetchJobPage: mocks.fetchJobPage,
}));
vi.mock("../lib/job-extraction", async (original) => ({
  ...(await original<typeof import("../lib/job-extraction")>()),
  extractJob: mocks.extractJob,
}));
import { POST as save } from "../app/api/workspace/route";
import { POST as fetchPage } from "../app/api/jobs/fetch/route";
import { POST as extract } from "../app/api/jobs/extract/route";
import { HttpError } from "../lib/server";
const id = "4b8954ca-4e61-4a04-838e-f145ba73422b";
const value = {
  company: "Acme",
  role: "Engineer",
  jd: "Build React interfaces and Node APIs.",
  stage: "Saved",
  notes: "Source: https://example.com/job",
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
function database(duplicate = false, owned = true) {
  const eq = vi.fn();
  eq.mockReturnValue({
    eq,
    maybeSingle: async () => ({ data: owned ? { id } : null, error: null }),
  });
  const insert = vi.fn(() => ({
    select: async () => ({
      data: duplicate ? null : [{ id }],
      error: duplicate ? { code: "23505" } : null,
    }),
  }));
  const from = vi.fn(() => ({ insert, select: vi.fn(() => ({ eq })) }));
  mocks.authenticated.mockResolvedValue({
    user: { id: "owner" },
    db: { from },
  });
  return { insert, eq };
}
it("creates an application with its stable confirmation ID and authenticated owner", async () => {
  const db = database();
  const response = await save(
    req({ entity: "job", action: "save", createId: id, value }),
  );
  expect(response.status).toBe(200);
  expect(db.insert).toHaveBeenCalledWith({ ...value, id, user_id: "owner" });
});
it("accepts a committed confirmation retry without updating or overwriting the record", async () => {
  const db = database(true);
  const response = await save(
    req({ entity: "job", action: "save", createId: id, value }),
  );
  expect(response.status).toBe(200);
  expect(db.eq).toHaveBeenCalledWith("id", id);
  expect(db.eq).toHaveBeenCalledWith("user_id", "owner");
  expect(db.insert).toHaveBeenCalledTimes(1);
});
it("accepts a retried manual experience save that reuses its creation ID", async () => {
  const db = database(true);
  const entry = { title: "Platform rewrite", body: "Led a Next.js migration." };
  const response = await save(
    req({ entity: "experience", action: "save", createId: id, value: entry }),
  );
  expect(response.status).toBe(200);
  expect(db.insert).toHaveBeenCalledWith({ ...entry, id, user_id: "owner" });
});
it("does not accept a conflicting creation ID belonging to another user", async () => {
  database(true, false);
  expect(
    (await save(req({ entity: "job", action: "save", createId: id, value })))
      .status,
  ).toBe(409);
});
it("rejects invalid confirmed fields before a database write", async () => {
  const db = database();
  expect(
    (
      await save(
        req({
          entity: "job",
          action: "save",
          createId: id,
          value: { ...value, jd: "" },
        }),
      )
    ).status,
  ).toBe(400);
  expect(db.insert).not.toHaveBeenCalled();
});
it("does not allow creation IDs to change the existing edit or delete behavior", async () => {
  const db = database();
  expect(
    (await save(req({ entity: "job", action: "delete", createId: id, id })))
      .status,
  ).toBe(400);
  expect(db.insert).not.toHaveBeenCalled();
});
it("spends the hosted extraction quota before calling the model", async () => {
  const rpc = vi.fn(async () => ({
    data: null,
    error: { message: "Hourly inference limit reached" },
  }));
  mocks.inferenceAccess.mockResolvedValue({ db: { rpc } });
  const response = await extract(req({ text: "x".repeat(200) }));
  expect(response.status).toBe(429);
  expect(rpc).toHaveBeenCalledWith("reserve_inference", {
    p_kind: "job_extraction",
  });
  expect(mocks.extractJob).not.toHaveBeenCalled();
});
it("guards page fetching and extraction before processing input", async () => {
  mocks.inferenceAccess.mockRejectedValue(new HttpError(403, "Access denied"));
  expect((await fetchPage(req({ url: "https://example.com" }))).status).toBe(
    403,
  );
  expect((await extract(req({ text: "x".repeat(100) }))).status).toBe(403);
  expect(mocks.fetchJobPage).not.toHaveBeenCalled();
  expect(mocks.extractJob).not.toHaveBeenCalled();
});
it("keeps fetch and extraction separate and disables caching", async () => {
  mocks.inferenceAccess.mockResolvedValue(null);
  mocks.fetchJobPage.mockResolvedValue({
    url: "https://example.com",
    text: "Job text",
    title: "Job",
    warnings: [],
  });
  const response = await fetchPage(req({ url: "https://example.com" }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.extractJob).not.toHaveBeenCalled();
});
it("rejects oversized extraction input before a model call", async () => {
  mocks.inferenceAccess.mockResolvedValue(null);
  expect((await extract(req({ text: "x".repeat(30001) }))).status).toBe(400);
  expect(mocks.extractJob).not.toHaveBeenCalled();
});
it("passes only inspected source text to the configured extraction provider", async () => {
  vi.stubEnv("AI_PROVIDER", "ollama");
  vi.stubEnv("OLLAMA_MODEL", "qwen3:8b");
  mocks.inferenceAccess.mockResolvedValue(null);
  mocks.extractJob.mockResolvedValue(value);
  const text = "x".repeat(100);
  expect(
    (await extract(req({ text, experience: ["private experience ignored"] })))
      .status,
  ).toBe(200);
  expect(mocks.extractJob).toHaveBeenCalledWith(
    text,
    expect.objectContaining({ provider: "ollama" }),
    expect.any(AbortSignal),
  );
});

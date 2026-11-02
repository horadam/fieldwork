// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountStore, browserStore, BROWSER_STORAGE_KEY } from "../lib/store";
import { apiClient, ApiError } from "../lib/api-client";
import { seed } from "../lib/seed";
import type { Workspace } from "../lib/domain";

const job = {
  company: "Acme",
  role: "Engineer",
  jd: "Build accessible React interfaces.",
  stage: "Saved" as const,
  notes: "",
};
const id = "4b8954ca-4e61-4a04-838e-f145ba73422b";
const empty: Workspace = { jobs: [], experience: [], runs: [], tasks: [] };
const saved = () =>
  JSON.parse(localStorage.getItem(BROWSER_STORAGE_KEY) || "null");
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("browser store", () => {
  const store = browserStore(() => localStorage);

  it("starts from the seed and fails interrupted runs on reload", async () => {
    expect((await store.load()).jobs).toEqual(seed.jobs);
    localStorage.setItem(
      BROWSER_STORAGE_KEY,
      JSON.stringify({
        ...empty,
        runs: [{ id: "r1", status: "running", application_id: "j" }],
      }),
    );
    const [run] = (await store.load()).runs;
    expect(run.status).toBe("failed");
    expect(run.error).toContain("interrupted");
  });

  it("makes a retried create idempotent and keeps edit position", async () => {
    const first = await store.save(empty, "job", { createId: id, value: job });
    const retry = await store.save(first, "job", { createId: id, value: job });
    expect(retry.jobs).toHaveLength(1);
    const two = await store.save(retry, "job", {
      createId: "other",
      value: { ...job, company: "Beta" },
    });
    const edited = await store.save(two, "job", {
      id,
      createId: "unused",
      value: { ...job, role: "Lead" },
    });
    expect(edited.jobs.map((j) => j.role)).toEqual(["Lead", "Engineer"]);
    expect(saved().jobs).toHaveLength(2);
  });

  it("keeps provenance when editing experience and caps the bank at 50", async () => {
    const current: Workspace = {
      ...empty,
      experience: [
        {
          id: "e1",
          title: "Old",
          body: "Old body text.",
          provenance: { kind: "role" } as never,
        },
      ],
    };
    const next = await store.save(current, "experience", {
      id: "e1",
      createId: "x",
      value: { title: "New", body: "New body text." },
    });
    expect(next.experience[0]).toMatchObject({ title: "New", provenance: {} });
    const full: Workspace = {
      ...empty,
      experience: Array.from({ length: 50 }, (_, i) => ({
        id: `e${i}`,
        title: "T",
        body: "Body text here.",
      })),
    };
    await expect(
      store.save(full, "experience", {
        createId: "new",
        value: { title: "T", body: "Body text here." },
      }),
    ).rejects.toThrow("limited to 50");
  });

  it("deletes a job with its runs and tasks", async () => {
    const current: Workspace = {
      jobs: [{ ...job, id: "j1" }],
      experience: [],
      runs: [{ id: "r1", application_id: "j1" } as never],
      tasks: [{ id: "t1", run_id: "r1", title: "", detail: "", done: false }],
    };
    const next = await store.remove(current, "job", "j1");
    expect(next).toEqual(empty);
  });

  it("rejects a change the browser cannot store, so forms stay open", async () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    } as unknown as Storage;
    await expect(
      browserStore(() => full).save(empty, "job", { createId: id, value: job }),
    ).rejects.toThrow("not saved");
  });
});

describe("account store", () => {
  function server() {
    const calls: { url: string; body?: unknown; auth?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          body: init.body ? JSON.parse(init.body as string) : undefined,
          auth: (init.headers as Record<string, string>).Authorization,
        });
        return Response.json(init.body ? { ok: true } : empty);
      }),
    );
    return calls;
  }

  it("sends the creation ID for new records and reloads after writes", async () => {
    const calls = server();
    const store = accountStore(apiClient(() => "session-token"));
    await store.save(empty, "experience", {
      createId: id,
      value: { title: "T", body: "Body text here." },
    });
    expect(calls[0]).toMatchObject({
      url: "/api/workspace",
      auth: "Bearer session-token",
      body: { entity: "experience", action: "save", createId: id },
    });
    expect(calls[1].url).toBe("/api/workspace");
    expect(calls[1].body).toBeUndefined();
  });

  it("sends only the record ID when editing", async () => {
    const calls = server();
    await accountStore(apiClient(() => "t")).save(empty, "job", {
      id,
      createId: "ignored",
      value: job,
    });
    expect(calls[0].body).toMatchObject({ id });
    expect(calls[0].body).not.toHaveProperty("createId");
  });

  it("saves a task without reloading the whole workspace", async () => {
    const calls = server();
    const current: Workspace = {
      ...empty,
      tasks: [{ id: "t1", run_id: "r", title: "", detail: "", done: false }],
    };
    const next = await accountStore(apiClient(() => "t")).setTaskDone(
      current,
      "t1",
      true,
    );
    expect(calls).toHaveLength(1);
    expect(next.tasks[0].done).toBe(true);
  });
});

describe("api client", () => {
  it("keeps the server's error code and status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "Hourly limit", code: "quota" },
          { status: 429 },
        ),
      ),
    );
    const error = await apiClient(() => "")("/api/x").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: "quota" });
  });
});

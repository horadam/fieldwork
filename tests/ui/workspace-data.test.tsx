// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useWorkspaceData } from "../../components/hooks/use-workspace-data";
import { BROWSER_STORAGE_KEY } from "../../lib/store";
import { seed } from "../../lib/seed";
import type { Workspace } from "../../lib/domain";

// A controllable Supabase session, so a test can sign in mid-analysis.
const auth = vi.hoisted(() => ({
  listener: null as
    | null
    | ((event: string, session: Record<string, unknown> | null) => void),
}));
vi.mock("@/lib/supabase-config", () => ({
  supabaseConfig: () => ({ url: "http://localhost:54321", key: "test" }),
}));
vi.mock("@/lib/supabase-browser", () => ({
  browserSupabase: () => ({
    auth: {
      onAuthStateChange: (
        cb: (event: string, session: Record<string, unknown> | null) => void,
      ) => {
        auth.listener = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  }),
}));

const ai = {
  provider: "ollama" as const,
  model: "qwen3:8b",
  ready: true,
  message: "ok",
};
const browserWorkspace: Workspace = {
  ...structuredClone(seed),
  tasks: [
    { id: "t1", run_id: "old", title: "Practise", detail: "", done: false },
  ],
};
const accountWorkspace: Workspace = {
  jobs: [{ ...seed.jobs[0], id: "account-job", company: "Account Co" }],
  experience: [],
  runs: [],
  tasks: [],
};
const output = {
  roleSummary: "Synthetic summary",
  requirements: [],
  gaps: [],
  questions: [],
  plan: [],
};
const stored = (): Workspace =>
  JSON.parse(localStorage.getItem(BROWSER_STORAGE_KEY) || "null");

// The local analysis answers only when the test says so.
let finishAnalysis: () => void;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(browserWorkspace));
  auth.listener = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/workspace") return Response.json(accountWorkspace);
      if (path === "/api/analyze/local")
        return new Promise<Response>((resolve) => {
          finishAnalysis = () =>
            resolve(
              Response.json({
                output,
                provider: "ollama",
                model: "qwen3:8b",
                promptVersion: "v1",
                durationMs: 10,
                inputTokens: 1,
                outputTokens: 1,
              }),
            );
        });
      throw new Error(`Unexpected request ${path}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function loaded() {
  const hook = renderHook(() => useWorkspaceData());
  await waitFor(() => expect(hook.result.current.data.tasks).toHaveLength(1));
  return hook;
}

describe("useWorkspaceData browser analysis", () => {
  it("keeps the completed simulated run, though it is patched in the same tick", async () => {
    const { result } = await loaded();
    await act(() =>
      result.current.runFitAnalysis(result.current.data.jobs[0], null, true),
    );
    for (const runs of [result.current.data.runs, stored().runs]) {
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("completed");
    }
  });

  it("keeps a task ticked while the analysis was running", async () => {
    const { result } = await loaded();
    let running!: Promise<void>;
    act(() => {
      running = result.current.runFitAnalysis(result.current.data.jobs[0], ai);
    });
    await waitFor(() => expect(result.current.analyzingJobId).not.toBeNull());
    await act(() => result.current.toggleTask("t1", true));
    await act(async () => {
      finishAnalysis();
      await running;
    });
    for (const workspace of [result.current.data, stored()]) {
      expect(workspace.tasks[0].done).toBe(true);
      expect(workspace.runs[0].status).toBe("completed");
    }
  });

  it("drops a result that arrives after sign-in instead of saving the account workspace in the browser", async () => {
    const { result } = await loaded();
    let running!: Promise<void>;
    act(() => {
      running = result.current.runFitAnalysis(result.current.data.jobs[0], ai);
    });
    await waitFor(() => expect(stored().runs).toHaveLength(1));
    act(() =>
      auth.listener!("SIGNED_IN", {
        access_token: "account-token",
        user: { id: "user-1", email: "person@example.com" },
      }),
    );
    await waitFor(() =>
      expect(result.current.data.jobs[0]?.id).toBe("account-job"),
    );
    await act(async () => {
      finishAnalysis();
      await running;
    });

    expect(result.current.data).toEqual(accountWorkspace);
    const browser = stored();
    expect(browser.jobs.map((j) => j.id)).toEqual(["demo-job"]);
    expect(browser.runs).toHaveLength(1);
    expect(browser.runs[0].status).toBe("running");
  });
});

describe("useWorkspaceData account session", () => {
  const session = (token: string, id = "user-1") => ({
    access_token: token,
    user: { id, email: `${id}@example.com` },
  });
  const savedJob = { ...accountWorkspace.jobs[0], id: "saved-job" };
  let account: Workspace;
  let finishSave: () => void;
  let calls: { path: string; method: string; bearer: string }[];
  beforeEach(() => {
    account = structuredClone(accountWorkspace);
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        calls.push({
          path,
          method: init.method || "GET",
          bearer: headers.Authorization || "",
        });
        if (path !== "/api/workspace")
          throw new Error(`Unexpected request ${path}`);
        if (init.method !== "POST") return Response.json(account);
        // A save answers only when the test says so.
        return new Promise<Response>((resolve) => {
          finishSave = () => resolve(Response.json({ ok: true }));
        });
      }),
    );
  });

  // Every `data` the hook rendered, to catch a brief blank workspace.
  async function signedIn() {
    const rendered: Workspace[] = [];
    const hook = renderHook(() => {
      const ws = useWorkspaceData();
      rendered.push(ws.data);
      return ws;
    });
    await waitFor(() => expect(auth.listener).not.toBeNull());
    act(() => auth.listener!("SIGNED_IN", session("token-1")));
    await waitFor(() =>
      expect(hook.result.current.data.jobs[0]?.id).toBe("account-job"),
    );
    return { ...hook, rendered };
  }
  const loads = () =>
    calls.filter((c) => c.path === "/api/workspace" && c.method === "GET");

  it("keeps the workspace on screen when the access token is refreshed", async () => {
    const { result, rendered } = await signedIn();
    const before = rendered.length;
    const loadsBefore = loads().length;
    act(() => auth.listener!("TOKEN_REFRESHED", session("token-2")));
    await act(async () => {});

    expect(rendered.slice(before).some((d) => d.jobs.length === 0)).toBe(false);
    expect(loads()).toHaveLength(loadsBefore);
    expect(result.current.token).toBe("token-2");
    expect(result.current.data).toEqual(accountWorkspace);
  });

  it("keeps a save that finishes after a token refresh, and reloads with the new token", async () => {
    const { result } = await signedIn();
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.saveRecord("job", {
        createId: "saved-job",
        value: {} as never,
      });
    });
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST")).toBe(true),
    );
    act(() => auth.listener!("TOKEN_REFRESHED", session("token-2")));
    account = { ...account, jobs: [savedJob, ...account.jobs] };
    await act(async () => {
      finishSave();
      expect(await saving).toBe(true);
    });

    expect(result.current.data.jobs.map((j) => j.id)).toEqual([
      "saved-job",
      "account-job",
    ]);
    expect(loads().at(-1)!.bearer).toBe("Bearer token-2");
  });

  it("reloads when a different user signs in", async () => {
    const { result, rendered } = await signedIn();
    const before = rendered.length;
    account = { ...accountWorkspace, jobs: [savedJob] };
    act(() => auth.listener!("SIGNED_IN", session("token-3", "user-2")));
    await waitFor(() =>
      expect(result.current.data.jobs[0]?.id).toBe("saved-job"),
    );

    expect(rendered.slice(before).some((d) => d.jobs.length === 0)).toBe(true);
    expect(loads().at(-1)!.bearer).toBe("Bearer token-3");
    expect(result.current.email).toBe("user-2@example.com");
  });
});

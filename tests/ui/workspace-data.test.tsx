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
        user: { email: "person@example.com" },
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

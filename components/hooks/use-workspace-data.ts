"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  demoAnalysis,
  jobInput,
  type Job,
  type Run,
  type Workspace as Data,
} from "@/lib/domain";
import type { ImportBatch } from "@/lib/resume";
import { seed } from "@/lib/seed";
import { apiClient } from "@/lib/api-client";
import {
  accountStore,
  browserStore,
  type Entity,
  type RecordValue,
} from "@/lib/store";
import { supabaseConfig } from "@/lib/supabase-config";
import type { AiStatus } from "./use-ai-status";

const empty: Data = { jobs: [], experience: [], runs: [], tasks: [] };
const message = (e: unknown, fallback: string) =>
  e instanceof Error ? e.message : fallback;

/**
 * Workspace data, session and every operation on them. Storage differences
 * live in lib/store; this hook owns the single copy of the data plus the
 * shell's busy/error feedback.
 */
export function useWorkspaceData() {
  const [data, setData] = useState<Data>(seed);
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [token, setToken] = useState("");
  const activeToken = useRef("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  const request = useMemo(() => apiClient(() => activeToken.current), []);
  const store = useMemo(
    () =>
      mode === "live"
        ? accountStore(request)
        : browserStore(() => localStorage),
    [mode, request],
  );
  // The latest data, so chained operations never start from a stale render.
  const dataRef = useRef(data);
  function commit(next: Data) {
    dataRef.current = next;
    setData(next);
  }
  // Applies a store result only if the same session is still active.
  async function apply(result: Promise<Data>) {
    const owner = activeToken.current;
    const next = await result;
    if (activeToken.current === owner) commit(next);
  }
  // In-progress changes, such as a running browser analysis.
  function update(change: (old: Data) => Data) {
    const next = change(dataRef.current);
    commit(next);
    try {
      store.persist(next);
    } catch (e) {
      setError(message(e, "Changes were not saved."));
    }
  }

  useEffect(() => {
    const browser = browserStore(() => localStorage);
    browser.load().then(commit, (e: Error) => setError(e.message));
    let config;
    try {
      config = supabaseConfig(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      );
    } catch (e) {
      setError(message(e, "Supabase configuration is invalid."));
      return;
    }
    if (!config) return;
    const db = createClient(config.url, config.key);
    setClient(db);
    const { data: listener } = db.auth.onAuthStateChange((_event, session) => {
      activeToken.current = session?.access_token || "";
      setToken(session?.access_token || "");
      setEmail(session?.user.email || "");
      setMode(session ? "live" : "demo");
      if (!session)
        browser.load().then(commit, () => commit(structuredClone(seed)));
    });
    return () => listener.subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!token) return;
    commit(empty);
    apply(accountStore(request).load()).catch((e) => setError(e.message));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Runs one shell-level action with the shared busy and error state.
  async function act(work: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await work();
      return true;
    } catch (e) {
      setError(message(e, "Something went wrong."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const saveRecord = (
    entity: Entity,
    record: { id?: string; createId: string; value: RecordValue },
  ) => act(() => apply(store.save(dataRef.current, entity, record)));
  const removeRecord = (entity: Entity, id: string) =>
    act(() => apply(store.remove(dataRef.current, entity, id)));

  // Import errors go back to the wizard, which keeps its drafts for a retry.
  async function importExperience(batch: ImportBatch) {
    setBusy(true);
    try {
      await apply(store.importExperience(dataRef.current, batch));
    } finally {
      setBusy(false);
    }
  }
  async function importJob(job: Job) {
    setBusy(true);
    try {
      await apply(
        store.save(dataRef.current, "job", {
          createId: job.id,
          value: jobInput.parse(job),
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function runJob(job: Job, ai: AiStatus | null, simulated = false) {
    setRunningJob(job.id);
    await act(async () => {
      if (mode === "live") {
        try {
          const result = await request<{ runId: string }>("/api/analyze", {
            body: { applicationId: job.id },
          });
          await apply(store.load());
          setSelectedRun(result.runId);
        } catch (e) {
          await apply(store.load());
          throw e;
        } finally {
          setRunningJob(null);
        }
        return;
      }
      if (!simulated && !ai)
        throw new Error(
          "Model status is unknown. Refresh model status and try again.",
        );
      const run: Run = {
        id: crypto.randomUUID(),
        application_id: job.id,
        status: "running",
        output: null,
        error: null,
        created_at: new Date().toISOString(),
        // The real prompt version arrives with the result.
        prompt_version: simulated ? "offline-preview" : "pending",
        provider: simulated ? "simulated" : ai!.provider,
        model: simulated ? "none" : ai!.model,
        duration_ms: null,
        jd_snapshot: job.jd,
        evidence_snapshot: structuredClone(dataRef.current.experience),
      };
      const runStarted = Date.now();
      const patch = (changes: Partial<Run>) =>
        update((old) => ({
          ...old,
          runs: old.runs.map((r) =>
            r.id === run.id ? { ...r, ...changes } : r,
          ),
        }));
      update((old) => ({ ...old, runs: [run, ...old.runs] }));
      setSelectedRun(run.id);
      try {
        if (simulated)
          patch({
            status: "completed",
            output: demoAnalysis(job, run.evidence_snapshot!),
          });
        else {
          const result = await request<{
            output: Run["output"];
            provider: Run["provider"];
            model: string;
            promptVersion: string;
            durationMs: number;
            inputTokens: number;
            outputTokens: number;
          }>("/api/analyze/local", {
            body: { jd: job.jd, experience: run.evidence_snapshot },
          });
          patch({
            status: "completed",
            output: result.output,
            model: result.model,
            provider: result.provider,
            prompt_version: result.promptVersion,
            duration_ms: result.durationMs,
            input_tokens: result.inputTokens,
            output_tokens: result.outputTokens,
          });
        }
      } catch (e) {
        patch({
          status: "failed",
          error: message(e, "Analysis failed"),
          duration_ms: Date.now() - runStarted,
        });
        throw e;
      } finally {
        setRunningJob(null);
      }
    });
  }
  const approve = (run: Run) =>
    act(() => apply(store.approve(dataRef.current, run)));

  // Shown at once and saved in the background; only this task reverts on
  // failure, and other checkboxes stay usable meanwhile.
  const [savingTask, setSavingTask] = useState<string | null>(null);
  async function toggleTask(id: string, done: boolean) {
    const setDone = (value: boolean) => (old: Data) => ({
      ...old,
      tasks: old.tasks.map((t) => (t.id === id ? { ...t, done: value } : t)),
    });
    const optimistic = setDone(done)(dataRef.current);
    commit(optimistic);
    setError("");
    setSavingTask(id);
    try {
      await store.setTaskDone(optimistic, id, done);
    } catch (e) {
      commit(setDone(!done)(dataRef.current));
      setError(message(e, "The task could not be saved."));
    } finally {
      setSavingTask(null);
    }
  }

  // Resolves to "confirm-email" when sign-up needs email confirmation first.
  async function authenticate(
    credentials: { email: string; password: string },
    signup: boolean,
  ): Promise<"signed-in" | "confirm-email" | "failed"> {
    let outcome: "signed-in" | "confirm-email" = "signed-in";
    const ok = await act(async () => {
      if (!client)
        throw new Error(
          "Live mode needs Supabase configuration. The browser workspace remains available.",
        );
      const response = signup
        ? await client.auth.signUp({
            ...credentials,
            options: { emailRedirectTo: `${window.location.origin}/` },
          })
        : await client.auth.signInWithPassword(credentials);
      if (response.error) throw response.error;
      if (!response.data.session) outcome = "confirm-email";
    });
    return ok ? outcome : "failed";
  }
  const signOut = () =>
    act(async () => {
      await client?.auth.signOut();
      setSelectedRun(null);
    });

  return {
    data,
    mode,
    token,
    email,
    canSignIn: !!client,
    request,
    busy,
    error,
    setError,
    runningJob,
    selectedRun,
    setSelectedRun,
    savingTask,
    saveRecord,
    removeRecord,
    importExperience,
    importJob,
    runJob,
    approve,
    toggleTask,
    authenticate,
    signOut,
  };
}

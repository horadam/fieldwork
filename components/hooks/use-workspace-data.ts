"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  demoAnalysis,
  jobInput,
  type AnalysisRun,
  type Job,
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
import { browserSupabase } from "@/lib/supabase-browser";
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
  // The access token changes on every refresh; the user changes only on
  // sign-in, sign-out or switching account. Requests use the latest token,
  // while reloads and ownership checks follow the user.
  const [token, setToken] = useState("");
  const activeToken = useRef("");
  const [userId, setUserId] = useState("");
  const activeUser = useRef("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [analyzingJobId, setAnalyzingJobId] = useState<string | null>(null);
  const [selectedAnalysisRunId, setSelectedAnalysisRunId] = useState<
    string | null
  >(null);

  const request = useMemo(() => apiClient(() => activeToken.current), []);
  const store = useMemo(
    () =>
      mode === "live"
        ? accountStore(request)
        : browserStore(() => localStorage),
    [mode, request],
  );
  // The latest data, so chained operations never start from a stale render.
  // Needed by code that runs after an await or twice in one tick: the
  // analysis patches and the task rollback.
  const dataRef = useRef(data);
  function commit(next: Data) {
    dataRef.current = next;
    setData(next);
  }
  // Applies a store result only if the same user is still signed in.
  async function apply(result: Promise<Data>) {
    const owner = activeUser.current;
    const next = await result;
    if (activeUser.current === owner) commit(next);
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
    const db = browserSupabase(config.url, config.key);
    setClient(db);
    const { data: listener } = db.auth.onAuthStateChange((_event, session) => {
      activeToken.current = session?.access_token || "";
      activeUser.current = session?.user.id || "";
      setToken(session?.access_token || "");
      setUserId(session?.user.id || "");
      setEmail(session?.user.email || "");
      setMode(session ? "live" : "demo");
      if (!session)
        browser.load().then(commit, () => commit(structuredClone(seed)));
    });
    return () => listener.subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!userId) return;
    commit(empty);
    apply(accountStore(request).load()).catch((e) => setError(e.message));
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function runFitAnalysis(
    job: Job,
    ai: AiStatus | null,
    simulated = false,
  ) {
    setAnalyzingJobId(job.id);
    await act(async () => {
      if (mode === "live") {
        try {
          const result = await request<{ analysisRunId: string }>(
            "/api/analyze",
            { body: { applicationId: job.id } },
          );
          await apply(store.load());
          setSelectedAnalysisRunId(result.analysisRunId);
        } catch (e) {
          await apply(store.load());
          throw e;
        } finally {
          setAnalyzingJobId(null);
        }
        return;
      }
      if (!simulated && !ai)
        throw new Error(
          "Model status is unknown. Refresh model status and try again.",
        );
      const analysisRun: AnalysisRun = {
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
      const analysisStartedAt = Date.now();
      // This closure keeps the browser store from the click. If the session
      // changed meanwhile, writing through it would put the account workspace
      // into localStorage; drop the result instead, and the next browser load
      // marks the run interrupted.
      const owner = activeUser.current;
      const patchAnalysisRun = (changes: Partial<AnalysisRun>) => {
        if (activeUser.current !== owner) return;
        update((old) => ({
          ...old,
          runs: old.runs.map((r) =>
            r.id === analysisRun.id ? { ...r, ...changes } : r,
          ),
        }));
      };
      update((old) => ({ ...old, runs: [analysisRun, ...old.runs] }));
      setSelectedAnalysisRunId(analysisRun.id);
      try {
        if (simulated)
          patchAnalysisRun({
            status: "completed",
            output: demoAnalysis(job, analysisRun.evidence_snapshot!),
          });
        else {
          const result = await request<{
            output: AnalysisRun["output"];
            provider: AnalysisRun["provider"];
            model: string;
            promptVersion: string;
            durationMs: number;
            inputTokens: number;
            outputTokens: number;
          }>("/api/analyze/local", {
            body: { jd: job.jd, experience: analysisRun.evidence_snapshot },
          });
          patchAnalysisRun({
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
        patchAnalysisRun({
          status: "failed",
          error: message(e, "Analysis failed"),
          duration_ms: Date.now() - analysisStartedAt,
        });
        throw e;
      } finally {
        setAnalyzingJobId(null);
      }
    });
  }
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
      setSelectedAnalysisRunId(null);
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
    analyzingJobId,
    selectedAnalysisRunId,
    setSelectedAnalysisRunId,
    savingTask,
    saveRecord,
    removeRecord,
    importExperience,
    importJob,
    runFitAnalysis,
    toggleTask,
    authenticate,
    signOut,
  };
}

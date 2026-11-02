"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  demoAnalysis,
  experienceInput,
  jobInput,
  type Job,
  type Experience,
  type Run,
  type Workspace as Data,
} from "@/lib/domain";
import { ResumeImport } from "./resume-import";
import { JobImport } from "./job-import";
import { type ImportBatch } from "@/lib/resume";
import { apiClient } from "@/lib/api-client";
import { accountStore, browserStore } from "@/lib/store";
import { seed } from "@/lib/seed";
import { interviewQuestions, weeks } from "@/lib/preparation";
import { PreparationWorkspace } from "./preparation-workspace";
import { ApplicationsView } from "./applications-view";
import { Dialog } from "./modals/dialog";
import { supabaseConfig } from "@/lib/supabase-config";

const empty: Data = { jobs: [], experience: [], runs: [], tasks: [] };
const tabs = [
  "Overview",
  "Experience",
  "Applications",
  "Interview practice",
  "Study plan",
  "Preparation tasks",
];
// 24px stroke paths, one per tab, shown alone when the sidebar is collapsed.
const tabIcons = [
  "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  "M4 8h16v11H4zM9 8V5h6v3",
  "M5 5h14v4H5zM5 11h14v4H5zM5 17h9",
  "M4 5h16v10H9l-5 4z",
  "M5 4h10l4 4v12H5zM9 12h6M9 16h6",
  "M4 12l5 5L20 6",
];
const navKey = "fieldwork-nav-collapsed";
type Modal =
  // createId is minted when the form opens, so a retried save reuses it.
  | { type: "job"; value?: Job; createId?: string }
  | { type: "experience"; value?: Experience; createId?: string }
  | { type: "job-import" }
  | { type: "import" }
  | { type: "auth" }
  | { type: "delete"; entity: "job" | "experience"; id: string };

export default function Workspace() {
  const [aiStatus, setAiStatus] = useState<{
    provider: "ollama" | "openai";
    model: string;
    ready: boolean;
    message: string;
  } | null>(null);
  const [tab, setTab] = useState(0);
  const [generalPreparation, setGeneralPreparation] = useState(true);
  const [preparationJob, setPreparationJob] = useState<string | null>(null);
  const [data, setData] = useState<Data>(seed);
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [token, setToken] = useState("");
  const activeToken = useRef("");
  const [email, setEmail] = useState("");
  const [modal, setModal] = useState<Modal | null>(null);
  const [error, setError] = useState("");
  // Non-error outcomes, such as "check your email" after sign-up.
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [question, setQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [showGuide, setShowGuide] = useState(false);
  const [study, setStudy] = useState<Record<string, boolean>>({});
  const [scores, setScores] = useState<Record<string, string>>({});
  const [practiceReady, setPracticeReady] = useState(false);
  const [practiceKey, setPracticeKey] = useState("");
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(false);

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
      setError(e instanceof Error ? e.message : "Changes were not saved.");
    }
  }
  useEffect(() => {
    const browser = browserStore(() => localStorage);
    browser
      .load()
      .then(commit, (e: Error) => setError(e.message))
      .finally(() => setReady(true));
    let config;
    try {
      config = supabaseConfig(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Supabase configuration is invalid.",
      );
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
  useEffect(() => {
    // Personal practice notes are isolated between demo and each authenticated account.
    setPracticeReady(false);
    const key = `fieldwork-practice-${mode === "live" ? email : "demo"}`;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "{}");
      setAnswers(saved.answers || {});
      setStudy(saved.study || {});
      setScores(saved.scores || {});
    } catch {
      setAnswers({});
      setStudy({});
      setScores({});
    }
    setPracticeKey(key);
    setPracticeReady(true);
  }, [mode, email]);
  useEffect(() => {
    const key = `fieldwork-practice-${mode === "live" ? email : "demo"}`;
    if (practiceReady && practiceKey === key) {
      try {
        localStorage.setItem(key, JSON.stringify({ answers, study, scores }));
      } catch {
        /* Workspace operations remain usable if practice persistence is unavailable. */
      }
    }
  }, [answers, study, scores, mode, email, practiceReady, practiceKey]);

  useEffect(() => {
    try {
      setNavCollapsed(localStorage.getItem(navKey) === "1");
    } catch {
      /* The expanded navigation is the default. */
    }
  }, []);
  function toggleNav() {
    const next = !navCollapsed;
    setNavCollapsed(next);
    try {
      localStorage.setItem(navKey, next ? "1" : "0");
    } catch {
      /* Preference only lasts for this page view. */
    }
  }

  useEffect(() => {
    void loadStatus();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  async function loadStatus() {
    try {
      setAiStatus(await request("/api/ai/status"));
    } catch {
      setAiStatus(null);
    }
  }
  async function act(work: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const current = modal;
    await act(async () => {
      if (current?.type !== "job" && current?.type !== "experience") return;
      const value =
        current.type === "job"
          ? jobInput.parse({
              company: form.get("company"),
              role: form.get("role"),
              jd: form.get("jd"),
              stage: form.get("stage"),
              notes: form.get("notes"),
            })
          : experienceInput.parse({
              title: form.get("title"),
              body: form.get("body"),
            });
      await apply(
        store.save(dataRef.current, current.type, {
          id: current.value?.id,
          createId: current.createId ?? crypto.randomUUID(),
          value,
        }),
      );
      setModal(null);
    });
  }
  async function remove() {
    if (modal?.type !== "delete") return;
    const { entity, id } = modal;
    await act(async () => {
      await apply(store.remove(dataRef.current, entity, id));
      setModal(null);
    });
  }
  // Import errors go back to the wizard, which keeps its drafts for a retry.
  async function confirmImport(batch: ImportBatch) {
    setBusy(true);
    try {
      await apply(store.importExperience(dataRef.current, batch));
    } finally {
      setBusy(false);
    }
  }
  async function confirmJobImport(job: Job) {
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
  async function runJob(job: Job, simulated = false) {
    setRunningJob(job.id);
    await act(async () => {
      if (mode === "live") {
        try {
          const result = await request<{ runId: string }>("/api/analyze", {
            body: { applicationId: job.id },
          });
          await apply(store.load());
          setSelected(result.runId);
        } catch (e) {
          await apply(store.load());
          throw e;
        } finally {
          setRunningJob(null);
        }
        return;
      }
      if (!simulated && !aiStatus)
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
        provider: simulated ? "simulated" : aiStatus!.provider,
        model: simulated ? "none" : aiStatus!.model,
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
      setSelected(run.id);
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
          error: e instanceof Error ? e.message : "Analysis failed",
          duration_ms: Date.now() - runStarted,
        });
        throw e;
      } finally {
        setRunningJob(null);
      }
    });
  }
  async function approve(run: Run) {
    await act(() => apply(store.approve(dataRef.current, run)));
  }
  // Shown at once and saved in the background; only this task reverts on failure.
  async function toggleTask(id: string, done: boolean) {
    const setDone = (value: boolean) => (old: Data) => ({
      ...old,
      tasks: old.tasks.map((t) => (t.id === id ? { ...t, done: value } : t)),
    });
    const optimistic = setDone(done)(dataRef.current);
    commit(optimistic);
    setError("");
    try {
      await store.setTaskDone(optimistic, id, done);
    } catch (e) {
      commit(setDone(!done)(dataRef.current));
      setError(e instanceof Error ? e.message : "The task could not be saved.");
    }
  }
  async function authenticate(
    event: FormEvent<HTMLFormElement>,
    signup = false,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setInfo("");
    await act(async () => {
      if (!client)
        throw new Error(
          "Live mode needs Supabase configuration. The browser workspace remains available.",
        );
      const credentials = {
        email: String(form.get("email")),
        password: String(form.get("password")),
      };
      const response = signup
        ? await client.auth.signUp({
            ...credentials,
            options: { emailRedirectTo: `${window.location.origin}/` },
          })
        : await client.auth.signInWithPassword(credentials);
      if (response.error) throw response.error;
      if (!response.data.session) {
        setInfo("Check your email to confirm your account, then sign in.");
        return;
      }
      setModal(null);
    });
  }
  const activeRun = data.runs.find((r) => r.id === selected);
  const progress = Object.values(study).filter(Boolean).length;
  const studyTotal = weeks.reduce((n, w) => n + w.items.length, 0);
  const title = [
    "Make your next move count.",
    "Your evidence, in your words.",
    "Your application pipeline.",
    "Practice with purpose.",
    "Four weeks. Steady progress.",
    "Turn insight into action.",
  ][tab];
  const subtitles = [
    "A focused workspace for the search, the practice, and the work ahead.",
    "Record only experience you can explain and defend in an interview.",
    "Track opportunities and prepare against what the role actually requires.",
    "One question at a time. Say it aloud, then refine your answer.",
    "10–15 hours a week, with something concrete to show for each one.",
    "Only plans you explicitly approve appear here.",
  ];

  return (
    <div className={`shell ${navCollapsed ? "collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand" aria-label="fieldwork">
            <span className="brand-full" aria-hidden="true">
              fieldwork
            </span>
            <span className="brand-short" aria-hidden="true">
              f
            </span>
            <span className="brand-mark" aria-hidden="true">
              ↗
            </span>
          </div>
          <button
            className="nav-toggle"
            aria-label={
              navCollapsed ? "Expand navigation" : "Collapse navigation"
            }
            aria-expanded={!navCollapsed}
            title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={toggleNav}
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={navCollapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
            </svg>
          </button>
        </div>
        <div className="eyebrow">Your next chapter</div>
        <nav aria-label="Workspace">
          {tabs.map((name, i) => (
            <button
              key={name}
              className={`nav ${tab === i ? "active" : ""}`}
              aria-current={tab === i ? "page" : undefined}
              title={navCollapsed ? name : undefined}
              onClick={() => {
                setTab(i);
                setSelected(null);
                setError("");
              }}
            >
              <svg
                className="nav-icon"
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={tabIcons[i]} />
              </svg>
              <span className="nav-label">{name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p>
            Small steps.
            <br />
            Defensible experience.
            <br />
            Better conversations.
          </p>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <p>
            CAREER WORKSPACE <span className="muted">/ {tabs[tab]}</span>
          </p>
          <div className="actions">
            <details className="status-pill">
              <summary>
                <span
                  className={`status-dot ${aiStatus?.ready ? "ready" : ""}`}
                  aria-hidden="true"
                />
                {email || "Browser storage"} ·{" "}
                {aiStatus
                  ? `${aiStatus.provider} ${aiStatus.model} ${aiStatus.ready ? "ready" : "unavailable"}`
                  : "model status unavailable"}
              </summary>
              <div className="status-panel">
                <p className="tiny">
                  <strong>
                    {mode === "demo"
                      ? "Browser workspace"
                      : "Private workspace"}
                  </strong>
                  <br />
                  {mode === "demo"
                    ? "Records are saved in this browser. Real analysis sends the selected JD and experience to the configured model. Simulated preview calls no model."
                    : `Signed in as ${email}. Records are saved to your Supabase workspace.`}
                </p>
                <p className="tiny">
                  <strong>
                    {aiStatus
                      ? `${aiStatus.provider} · ${aiStatus.model}`
                      : "Model status unavailable"}
                  </strong>
                  {aiStatus?.message && (
                    <>
                      <br />
                      {aiStatus.message}
                    </>
                  )}
                </p>
                <button className="button secondary small" onClick={loadStatus}>
                  Refresh model status
                </button>
              </div>
            </details>
            {mode === "live" ? (
              <button
                className="button secondary small"
                onClick={() =>
                  act(async () => {
                    await client?.auth.signOut();
                    setSelected(null);
                  })
                }
              >
                Sign out
              </button>
            ) : (
              <button
                className="button secondary small"
                onClick={() => setModal({ type: "auth" })}
              >
                Sign in
              </button>
            )}
          </div>
        </div>
        <header className="header">
          <div>
            <div className="eyebrow">
              {tab === 0 ? "Prepare · build · progress" : tabs[tab]}
            </div>
            <h1>{title}</h1>
            <p className="sub">{subtitles[tab]}</p>
          </div>
          {tab === 2 && (
            <div className="actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setModal({ type: "job-import" })}
              >
                Import job from URL
              </button>
              <button
                className="button"
                onClick={() =>
                  setModal({ type: "job", createId: crypto.randomUUID() })
                }
              >
                + Add application
              </button>
            </div>
          )}
          {tab === 1 && (
            <div className="actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setModal({ type: "import" })}
              >
                Import resume
              </button>
              <button
                className="button"
                onClick={() =>
                  setModal({
                    type: "experience",
                    createId: crypto.randomUUID(),
                  })
                }
              >
                + Add experience
              </button>
            </div>
          )}
        </header>
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        {busy && !(runningJob && tab === 2) && (
          <div role="status" className="notice">
            {runningJob
              ? "Analysis running. You can review other sections while you wait."
              : "Saving your changes…"}
          </div>
        )}

        {tab === 0 && (
          <>
            <section className="card hero">
              <div className="eyebrow">Interview preparation</div>
              <h2>
                A clear story for your
                <br />
                next conversation.
              </h2>
              <p className="sub">
                Prepare your introduction, two real AI product stories, and the
                decisions you helped make.
              </p>
              <div className="actions" style={{ marginTop: 24 }}>
                <button className="button accent" onClick={() => setTab(3)}>
                  Start interview practice ↗
                </button>
                <span className="tag">150-minute prep plan</span>
              </div>
            </section>
            <div className="stats">
              <div className="stat">
                <strong>{data.jobs.length.toString().padStart(2, "0")}</strong>
                <span>Applications tracked</span>
              </div>
              <div className="stat">
                <strong>
                  {data.experience.length.toString().padStart(2, "0")}
                </strong>
                <span>Experience records</span>
              </div>
              <div className="stat">
                <strong>
                  {data.tasks
                    .filter((t) => !t.done)
                    .length.toString()
                    .padStart(2, "0")}
                </strong>
                <span>Tasks to work on</span>
              </div>
            </div>
            <div className="grid">
              <section className="card">
                <div className="eyebrow">Your next three steps</div>
                <h2>Start with what matters.</h2>
                {[
                  {
                    title: "Own your story",
                    detail:
                      "Clarify your contribution, one tradeoff, and evidence of the outcome.",
                    target: 3,
                  },
                  {
                    title: "Know your gaps",
                    detail:
                      "Review Next.js, Supabase, and the server-to-database path.",
                    target: 4,
                  },
                  {
                    title: "Build something useful",
                    detail:
                      "Turn a real job description into a grounded preparation workflow.",
                    target: 2,
                  },
                ].map((s, i) => (
                  <div className="list-row" key={s.title}>
                    <span className="index">0{i + 1}</span>
                    <div className="grow">
                      <h3>{s.title}</h3>
                      <p className="tiny muted">{s.detail}</p>
                    </div>
                    <button
                      className="button secondary small"
                      aria-label={`Open ${s.title}`}
                      onClick={() => setTab(s.target)}
                    >
                      ↗
                    </button>
                  </div>
                ))}
              </section>
              <section className="card">
                <div className="eyebrow">The four-week sprint</div>
                <h2>Build confidence by building.</h2>
                <p className="muted">
                  Six hours building, four practicing, two studying. Keep the
                  feature scope small and the learning deliberate.
                </p>
                <div className="progress">
                  <span
                    style={{ width: `${(progress / studyTotal) * 100}%` }}
                  />
                </div>
                <p className="tiny muted">
                  {progress} of {studyTotal} study blocks completed
                </p>
                <button className="button secondary" onClick={() => setTab(4)}>
                  Open study plan
                </button>
                <details style={{ marginTop: 22 }}>
                  <summary>What makes a strong answer?</summary>
                  <p className="tiny">
                    Problem → your responsibility → decision and alternative →
                    implementation → evidence → lesson. State shared ownership
                    precisely.
                  </p>
                </details>
              </section>
            </div>
          </>
        )}

        {tab === 2 && (
          <ApplicationsView
            workspace={data}
            mode={mode}
            busy={busy}
            aiReady={!!aiStatus?.ready}
            runningJob={runningJob}
            selectedRun={selected}
            onSelectRun={setSelected}
            onAnalyze={(job, simulated) => runJob(job, simulated)}
            onPrepare={(job) => {
              setPreparationJob(job.id);
              setTab(3);
            }}
            onEdit={(job) => setModal({ type: "job", value: job })}
            onDelete={(job) =>
              setModal({ type: "delete", entity: "job", id: job.id })
            }
            onApprove={approve}
            onAdd={() =>
              setModal({ type: "job", createId: crypto.randomUUID() })
            }
          />
        )}

        {tab === 1 && (
          <>
            {data.experience.length === 0 && (
              <div className="empty">
                <h2>Start with a real example.</h2>
                <p>
                  Add a project you can discuss, including your contribution and
                  outcome.
                </p>
              </div>
            )}
            {data.experience.map((e) => (
              <article className="card" key={e.id}>
                <h2>{e.title}</h2>
                <p style={{ whiteSpace: "pre-wrap" }}>{e.body}</p>
                {e.provenance && (
                  <details>
                    <summary>Resume import details</summary>
                    <p className="tiny muted">
                      {e.provenance.organization} · {e.provenance.role} ·{" "}
                      {e.provenance.dates || "Dates not supplied"}
                      <br />
                      {e.provenance.provider} · {e.provenance.model} ·{" "}
                      {e.provenance.promptVersion}
                    </p>
                    <p className="tiny muted">
                      Details reviewed and confirmed by the user.
                    </p>
                  </details>
                )}
                <div className="actions">
                  <button
                    className="button secondary small"
                    onClick={() => setModal({ type: "experience", value: e })}
                  >
                    Edit experience
                  </button>
                  <button
                    className="button danger small"
                    onClick={() =>
                      setModal({
                        type: "delete",
                        entity: "experience",
                        id: e.id,
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
            <p className="tiny muted">
              Use user-confirmed facts. Analysis runs retain the evidence
              snapshot used at generation time.
            </p>
          </>
        )}

        <PreparationWorkspace
          key={`${mode}:${email}`}
          section={tab}
          workspace={data}
          token={token}
          scope={mode === "live" ? email : "browser"}
          requestedJob={preparationJob}
          onRequestHandled={() => setPreparationJob(null)}
          onGeneralChange={setGeneralPreparation}
          analyze={runJob}
          toggleLegacy={toggleTask}
          provider={
            aiStatus
              ? `${aiStatus.provider} · ${aiStatus.model}`
              : "configured model"
          }
        />

        {tab === 3 && generalPreparation && (
          <>
            <div className="grid">
              <section className="card practice">
                <div className="eyebrow">
                  Question {question + 1} of {interviewQuestions.length}
                </div>
                <h2>{interviewQuestions[question].question}</h2>
                <p className="tiny muted">
                  Aim for 60–120 seconds. Answer before opening the guide.
                </p>
                <label htmlFor="answer" className="tiny">
                  Your answer notes · saved in this browser
                </label>
                <textarea
                  id="answer"
                  value={answers[question] || ""}
                  onChange={(e) =>
                    setAnswers({ ...answers, [question]: e.target.value })
                  }
                  placeholder="Start with the user problem and your specific contribution…"
                />
                <div className="actions">
                  <button
                    className="button"
                    onClick={() => setShowGuide(!showGuide)}
                  >
                    {showGuide ? "Hide answer guide" : "Review answer guide"}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setQuestion((question + 1) % interviewQuestions.length);
                      setShowGuide(false);
                    }}
                  >
                    Next question →
                  </button>
                </div>
                {showGuide && (
                  <div className="evidence">
                    {interviewQuestions[question].guidance}
                  </div>
                )}
                <h3 style={{ marginTop: 25 }}>Self-review</h3>
                <p className="tiny muted">
                  Score your actual answer. 1 = weak, 3 = concrete but
                  incomplete, 5 = clear and defensible. This is not an automated
                  assessment.
                </p>
                <div className="score">
                  {[
                    "Clarity",
                    "Correctness",
                    "Depth",
                    "Tradeoffs",
                    "Ownership",
                  ].map((label) => (
                    <label key={label}>
                      {label}
                      <select
                        aria-label={`${label} score`}
                        value={scores[`${question}-${label}`] || ""}
                        onChange={(e) =>
                          setScores({
                            ...scores,
                            [`${question}-${label}`]: e.target.value,
                          })
                        }
                      >
                        <option value="">—</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </section>
              <section className="card">
                <div className="eyebrow">General preparation</div>
                <h2>Your 150-minute preparation.</h2>
                {[
                  ["20 min", "Introduction and motivation"],
                  ["45 min", "Two real AI product stories"],
                  ["30 min", "Eight likely questions"],
                  ["20 min", "Stack and evaluation refresh"],
                  ["25 min", "Mock interview and retry"],
                  ["10 min", "Your questions and logistics"],
                ].map(([time, item]) => (
                  <div className="list-row" key={time + item}>
                    <span className="tiny muted" style={{ minWidth: 50 }}>
                      {time}
                    </span>
                    <strong className="tiny">{item}</strong>
                  </div>
                ))}
                <details>
                  <summary>Your story structure</summary>
                  <p className="tiny">
                    Problem → responsibility → decision and alternative →
                    implementation → evidence → lesson.
                  </p>
                </details>
                <details>
                  <summary>Questions for the interviewer</summary>
                  <ul className="tiny">
                    <li>What would I own in the first 90 days?</li>
                    <li>How do you evaluate AI quality today?</li>
                    <li>What do the next interview stages assess?</li>
                  </ul>
                </details>
                <details>
                  <summary>Before an interview · 15 minutes</summary>
                  <p className="tiny">
                    Review your introduction and story outlines, ownership and
                    metric caveats, then company/product notes and call setup.
                  </p>
                </details>
              </section>
            </div>
            <section className="card">
              <h2>Evidence before confidence.</h2>
              <p className="quote">
                “One decision I influenced was… We considered… My contribution
                was… The evidence we had was…”
              </p>
              <p className="muted">
                Do not invent evaluation results, independent leadership, or the
                measurement behind a resume metric. Qualify what you cannot
                substantiate.
              </p>
            </section>
          </>
        )}

        {tab === 4 && generalPreparation && (
          <>
            <div className="notice">
              Default: 12h/week · 6h build + 4h interview practice + 2h study.
              At 10h, trim polish. At 15h, add practice. Progress is saved in
              this browser.
            </div>
            <div className="grid">
              {weeks.map((week, wi) => (
                <section className="card study-card" key={week.title}>
                  <div className="eyebrow">
                    Week 0{wi + 1} · {week.dates}
                  </div>
                  <h2>{week.title}</h2>
                  <p className="tiny muted">{week.outcome}</p>
                  {week.items.map((item, i) => (
                    <label className="study-row" key={item}>
                      <input
                        type="checkbox"
                        checked={study[`${wi}-${i}`] || false}
                        onChange={(e) =>
                          setStudy({
                            ...study,
                            [`${wi}-${i}`]: e.target.checked,
                          })
                        }
                      />
                      <span>{item}</span>
                    </label>
                  ))}
                </section>
              ))}
            </div>
          </>
        )}

        {tab === 5 && generalPreparation && (
          <>
            {data.tasks.length === 0 ? (
              <div className="empty">
                <h2>Your plan is yours to approve.</h2>
                <p className="muted">
                  Analyze an application, review the proposed tasks, and approve
                  a plan.
                </p>
                <button className="button" onClick={() => setTab(2)}>
                  Open applications
                </button>
              </div>
            ) : (
              <section className="card">
                {data.tasks.map((task) => (
                  <label
                    className={`check ${task.done ? "done" : ""}`}
                    key={task.id}
                  >
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={task.done}
                      onChange={(e) => toggleTask(task.id, e.target.checked)}
                    />
                    <div>
                      <strong className="task-title">{task.title}</strong>
                      <p className="tiny muted">{task.detail}</p>
                    </div>
                  </label>
                ))}
              </section>
            )}
          </>
        )}
        <footer>
          FIELDWORK · Built for deliberate progress.{" "}
          {mode === "demo"
            ? "Workspace data and practice notes stay in this browser."
            : "Workspace records use your authenticated account. Practice notes stay in this browser."}
        </footer>
      </main>

      {modal && (
        <Dialog
          title={
            modal.type === "job-import"
              ? "Import job from URL"
              : modal.type === "import"
                ? "Import resume"
                : modal.type === "auth"
                  ? "Your private workspace"
                  : modal.type === "delete"
                    ? "Delete this record?"
                    : modal.type === "job"
                      ? modal.value
                        ? "Edit application"
                        : "Add application"
                      : modal.type === "experience" && modal.value
                        ? "Edit experience"
                        : "Add user-confirmed experience"
          }
          close={() => {
            if (!busy) setModal(null);
          }}
        >
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
          {modal.type === "job-import" ? (
            <JobImport
              provider={
                aiStatus
                  ? `${aiStatus.provider} · ${aiStatus.model}`
                  : "configured model"
              }
              request={(path, value, signal) =>
                request(path, { body: value, signal })
              }
              confirm={confirmJobImport}
              close={() => setModal(null)}
            />
          ) : modal.type === "import" ? (
            <ResumeImport
              existing={data.experience}
              provider={
                aiStatus
                  ? `${aiStatus.provider} · ${aiStatus.model}`
                  : "configured model"
              }
              request={(source, signal) =>
                request("/api/resume/extract", { body: source, signal })
              }
              confirm={confirmImport}
              close={() => setModal(null)}
            />
          ) : modal.type === "auth" ? (
            <>
              {info && (
                <div role="status" className="notice">
                  {info}
                </div>
              )}
              <p className="tiny muted">
                {client
                  ? "Sign in or create an account. Email confirmation may be required."
                  : "Live sign-in is not configured. Use the browser workspace; setup instructions are included with the source."}
              </p>
              <form className="form" onSubmit={authenticate}>
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                  />
                </label>
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    minLength={8}
                    required
                    autoComplete="current-password"
                  />
                </label>
                <div className="actions">
                  <button disabled={busy || !client} className="button">
                    Sign in
                  </button>
                  <button
                    disabled={busy || !client}
                    type="button"
                    className="button secondary"
                    onClick={(e) => {
                      const form = e.currentTarget.closest("form")!;
                      if (form.reportValidity())
                        authenticate(
                          {
                            preventDefault: () => {},
                            currentTarget: form,
                          } as FormEvent<HTMLFormElement>,
                          true,
                        );
                    }}
                  >
                    Create account
                  </button>
                </div>
              </form>
            </>
          ) : modal.type === "delete" ? (
            <>
              <p>
                {modal.entity === "job"
                  ? "This also removes its analysis history and earlier approved tasks. Saved preparation plan snapshots and progress remain; affected targets will need their membership repaired before regeneration."
                  : "Previous analysis runs keep their saved evidence snapshot."}
              </p>
              <div className="actions">
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={remove}
                >
                  Delete record
                </button>
                <button
                  className="button secondary"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <form className="form" onSubmit={save}>
              {modal.type === "job" ? (
                <>
                  <div className="twocol">
                    <label>
                      Company
                      <input
                        name="company"
                        defaultValue={modal.value?.company}
                        maxLength={160}
                        required
                      />
                    </label>
                    <label>
                      Role
                      <input
                        name="role"
                        defaultValue={modal.value?.role}
                        maxLength={160}
                        required
                      />
                    </label>
                  </div>
                  <label>
                    Stage
                    <select
                      name="stage"
                      defaultValue={modal.value?.stage || "Saved"}
                    >
                      {["Saved", "Applied", "Interview", "Offer", "Closed"].map(
                        (s) => (
                          <option key={s}>{s}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    Job description
                    <textarea
                      name="jd"
                      defaultValue={modal.value?.jd}
                      minLength={20}
                      maxLength={15000}
                      required
                      placeholder="Paste the requirements here…"
                    />
                  </label>
                  <label>
                    Notes
                    <textarea
                      name="notes"
                      defaultValue={modal.value?.notes || ""}
                      maxLength={4000}
                      style={{ minHeight: 70 }}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Experience title
                    <input
                      name="title"
                      defaultValue={modal.value?.title}
                      maxLength={160}
                      required
                      placeholder="Project or delivery example"
                    />
                  </label>
                  <label>
                    User-confirmed details
                    <textarea
                      name="body"
                      defaultValue={modal.value?.body}
                      minLength={10}
                      maxLength={5000}
                      required
                      placeholder="User problem, your contribution, tradeoffs, and defensible outcomes…"
                    />
                  </label>
                </>
              )}
              <button className="button" disabled={busy}>
                Save {modal.type === "job" ? "application" : "experience"}
              </button>
            </form>
          )}
        </Dialog>
      )}
    </div>
  );
}

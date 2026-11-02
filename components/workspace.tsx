"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  approveLocal,
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
import { importLocal, type ImportBatch } from "@/lib/resume";
import { seed } from "@/lib/seed";
import { interviewQuestions, weeks } from "@/lib/preparation";
import { PreparationWorkspace } from "./preparation-workspace";
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
const storageKey = "fieldwork-demo-v1";
type Modal =
  | { type: "job"; value?: Job }
  | { type: "experience"; value?: Experience }
  | { type: "job-import" }
  | { type: "import" }
  | { type: "auth" }
  | { type: "delete"; entity: "job" | "experience"; id: string };

function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current!;
    const focusable = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          "button,input,textarea,select,a[href]",
        ),
      ).filter((e) => !e.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab") {
        const list = focusable();
        const first = list[0];
        const last = list[list.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    root.addEventListener("keydown", key);
    return () => {
      root.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [close]);
  return (
    <div className="dialog-shade">
      <div
        className="dialog"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="dialog-top">
          <h2 id="dialog-title">{title}</h2>
          <button className="close" aria-label="Close dialog" onClick={close}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Workspace() {
  const [aiStatus, setAiStatus] = useState<{
    provider: string;
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
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [question, setQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [showGuide, setShowGuide] = useState(false);
  const [study, setStudy] = useState<Record<string, boolean>>({});
  const [scores, setScores] = useState<Record<string, string>>({});
  const [practiceReady, setPracticeReady] = useState(false);
  const [practiceKey, setPracticeKey] = useState("");
  const [runningJob, setRunningJob] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const restored: Data = JSON.parse(saved);
        restored.runs = restored.runs.map((r) =>
          r.status === "running" || r.status === "pending"
            ? {
                ...r,
                status: "failed",
                error:
                  "Execution interrupted by reload. Retry explicitly; no tasks were created.",
              }
            : r,
        );
        setData(restored);
      }
    } catch {
      setError("Saved browser data could not be loaded.");
    }
    setReady(true);
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
      if (!session) {
        try {
          setData(
            JSON.parse(localStorage.getItem(storageKey) || "null") || seed,
          );
        } catch {
          setData(seed);
        }
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (ready && mode === "demo") {
      try {
        localStorage.setItem(storageKey, JSON.stringify(data));
      } catch {
        setError("Browser storage is full; changes may not survive reload.");
      }
    }
  }, [data, ready, mode]);
  useEffect(() => {
    if (token) {
      setData(empty);
      refresh(token).catch((e) => setError(e.message));
    }
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
    void loadStatus();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  async function loadStatus() {
    try {
      setAiStatus(await request("/api/ai/status"));
    } catch {
      setAiStatus(null);
    }
  }
  async function request(
    path: string,
    value?: unknown,
    override?: string,
    signal?: AbortSignal,
  ) {
    const response = await fetch(path, {
      signal,
      method: value ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(override || token
          ? { Authorization: `Bearer ${override || token}` }
          : {}),
      },
      ...(value ? { body: JSON.stringify(value) } : {}),
    });
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(result.error || "Request failed."), {
        code: result.code,
      });
    return result;
  }
  async function refresh(override?: string) {
    const requestedToken = override || token;
    const next = await request("/api/workspace", undefined, requestedToken);
    if (activeToken.current === requestedToken) setData(next);
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
      if (mode === "live") {
        await request("/api/workspace", {
          entity: current.type,
          action: "save",
          id: current.value?.id,
          value,
        });
        await refresh();
      } else {
        if (
          current.type === "experience" &&
          !current.value &&
          data.experience.length >= 50
        )
          throw new Error("Experience bank is limited to 50 entries.");
        const id = current.value?.id || crypto.randomUUID();
        setData((old) =>
          current.type === "job"
            ? {
                ...old,
                jobs: [
                  ...old.jobs.filter((x) => x.id !== id),
                  { ...value, id } as Job,
                ],
              }
            : {
                ...old,
                experience: [
                  ...old.experience.filter((x) => x.id !== id),
                  { ...current.value, ...value, id } as Experience,
                ],
              },
        );
      }
      setModal(null);
    });
  }
  async function remove() {
    if (modal?.type !== "delete") return;
    const { entity, id } = modal;
    await act(async () => {
      if (mode === "live") {
        await request("/api/workspace", { entity, action: "delete", id });
        await refresh();
      } else
        setData((old) =>
          entity === "experience"
            ? { ...old, experience: old.experience.filter((x) => x.id !== id) }
            : {
                ...old,
                jobs: old.jobs.filter((x) => x.id !== id),
                runs: old.runs.filter((r) => r.application_id !== id),
                tasks: old.tasks.filter(
                  (t) =>
                    !old.runs.some(
                      (r) => r.id === t.run_id && r.application_id === id,
                    ),
                ),
              },
        );
      setModal(null);
    });
  }
  async function confirmImport(batch: ImportBatch) {
    setBusy(true);
    try {
      if (mode === "live") {
        await request("/api/experience/import", batch);
        await refresh();
      } else {
        const next = {
          ...data,
          experience: importLocal(data.experience, batch),
        };
        // Persist before closing the review; failed saves leave drafts available for retry.
        localStorage.setItem(storageKey, JSON.stringify(next));
        setData(next);
      }
    } finally {
      setBusy(false);
    }
  }
  async function confirmJobImport(job: Job) {
    setBusy(true);
    try {
      const value = jobInput.parse(job);
      if (mode === "live") {
        await request("/api/workspace", {
          entity: "job",
          action: "save",
          createId: job.id,
          value,
        });
        await refresh();
      } else {
        const next = {
          ...data,
          jobs: [
            ...data.jobs.filter((item) => item.id !== job.id),
            { ...value, id: job.id },
          ],
        };
        localStorage.setItem(storageKey, JSON.stringify(next));
        setData(next);
      }
    } finally {
      setBusy(false);
    }
  }
  async function runJob(job: Job, simulated = false) {
    setRunningJob(job.id);
    await act(async () => {
      if (mode === "live") {
        try {
          const result = await request("/api/analyze", {
            applicationId: job.id,
          });
          await refresh();
          setSelected(result.runId);
        } catch (e) {
          await refresh();
          throw e;
        } finally {
          setRunningJob(null);
        }
        return;
      }
      const run: Run = {
        id: crypto.randomUUID(),
        application_id: job.id,
        status: "running",
        output: null,
        error: null,
        created_at: new Date().toISOString(),
        prompt_version: simulated ? "offline-preview" : "grounded-v3",
        provider: simulated
          ? "simulated"
          : (aiStatus?.provider as "ollama" | "openai"),
        model: simulated ? "none" : aiStatus?.model || "unknown",
        duration_ms: null,
        jd_snapshot: job.jd,
        evidence_snapshot: structuredClone(data.experience),
      };
      const runStarted = Date.now();
      setData((old) => ({ ...old, runs: [run, ...old.runs] }));
      setSelected(run.id);
      try {
        if (simulated) {
          const output = demoAnalysis(job, run.evidence_snapshot!);
          setData((old) => ({
            ...old,
            runs: old.runs.map((r) =>
              r.id === run.id ? { ...r, status: "completed", output } : r,
            ),
          }));
        } else {
          const result = await request("/api/analyze/local", {
            jd: job.jd,
            experience: run.evidence_snapshot,
          });
          setData((old) => ({
            ...old,
            runs: old.runs.map((r) =>
              r.id === run.id
                ? {
                    ...r,
                    status: "completed",
                    output: result.output,
                    model: result.model,
                    provider: result.provider,
                    prompt_version: result.promptVersion,
                    duration_ms: result.durationMs,
                    input_tokens: result.inputTokens,
                    output_tokens: result.outputTokens,
                  }
                : r,
            ),
          }));
        }
      } catch (e) {
        setData((old) => ({
          ...old,
          runs: old.runs.map((r) =>
            r.id === run.id
              ? {
                  ...r,
                  status: "failed",
                  error: e instanceof Error ? e.message : "Analysis failed",
                  duration_ms: Date.now() - runStarted,
                }
              : r,
          ),
        }));
        throw e;
      } finally {
        setRunningJob(null);
      }
    });
  }
  async function approve(run: Run) {
    await act(async () => {
      if (mode === "live") {
        await request("/api/approve", { runId: run.id });
        await refresh();
      } else setData((old) => approveLocal(old, run));
    });
  }
  async function toggleTask(id: string, done: boolean) {
    await act(async () => {
      if (mode === "live") {
        await request("/api/workspace", {
          entity: "task",
          action: "save",
          id,
          value: { done },
        });
        await refresh();
      } else
        setData((old) => ({
          ...old,
          tasks: old.tasks.map((t) => (t.id === id ? { ...t, done } : t)),
        }));
    });
  }
  async function authenticate(
    event: FormEvent<HTMLFormElement>,
    signup = false,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
        setError("Check your email to confirm your account, then sign in.");
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
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          fieldwork<span>↗</span>
        </div>
        <div className="eyebrow">Your next chapter</div>
        <nav aria-label="Workspace">
          {tabs.map((name, i) => (
            <button
              key={name}
              className={`nav ${tab === i ? "active" : ""}`}
              onClick={() => {
                setTab(i);
                setSelected(null);
                setError("");
              }}
            >
              <span className="num">0{i + 1}</span>
              {name}
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
          <span className="mode">
            {mode === "demo" ? "Browser workspace" : "Private workspace"}
          </span>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <p>
            CAREER WORKSPACE <span className="muted">/ {tabs[tab]}</span>
          </p>
          <div className="actions">
            <span className="tiny muted">{email || "Browser storage"}</span>
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
                onClick={() => setModal({ type: "job" })}
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
                onClick={() => setModal({ type: "experience" })}
              >
                + Add experience
              </button>
            </div>
          )}
        </header>
        {mode === "demo" && (
          <div className="notice">
            Browser workspace · Records are saved in this browser. Real analysis
            sends the selected JD and experience to the configured model.
            Simulated preview calls no model.
          </div>
        )}
        <div className="notice">
          <strong>
            {aiStatus
              ? `${aiStatus.provider} · ${aiStatus.model}`
              : "Model status unavailable"}
          </strong>{" "}
          · {aiStatus?.message}{" "}
          <button className="button secondary small" onClick={loadStatus}>
            Refresh model status
          </button>
        </div>
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        {busy && (
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
          <>
            <label className="sr-only" htmlFor="search">
              Search applications
            </label>
            <input
              id="search"
              className="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company or role…"
            />
            {data.jobs.length === 0 ? (
              <div className="empty">
                <h2>Your search starts here.</h2>
                <p className="muted">
                  Add a job description to build a preparation plan.
                </p>
                <button
                  className="button"
                  onClick={() => setModal({ type: "job" })}
                >
                  Add your first application
                </button>
              </div>
            ) : (
              <div className="job-list">
                {data.jobs
                  .filter((j) =>
                    `${j.company} ${j.role}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((job) => (
                    <article className="job-card" key={job.id}>
                      <div className="actions">
                        <span className="badge">{job.stage}</span>
                      </div>
                      <p className="job-company">{job.company}</p>
                      <h2>{job.role}</h2>
                      {job.notes && <p className="tiny muted">{job.notes}</p>}
                      <details>
                        <summary className="tiny">Job description</summary>
                        <p className="tiny" style={{ whiteSpace: "pre-wrap" }}>
                          {job.jd}
                        </p>
                      </details>
                      <div className="actions">
                        <button
                          className="button small"
                          disabled={busy || !aiStatus?.ready}
                          onClick={() => runJob(job)}
                        >
                          Analyze fit
                        </button>
                        <button
                          className="button secondary small"
                          disabled={busy}
                          onClick={() => {
                            setPreparationJob(job.id);
                            setTab(3);
                          }}
                        >
                          Prepare for this job
                        </button>
                        {mode === "demo" && (
                          <button
                            className="button secondary small"
                            disabled={busy}
                            onClick={() => runJob(job, true)}
                          >
                            Simulated preview
                          </button>
                        )}
                        <button
                          className="button secondary small"
                          onClick={() => setModal({ type: "job", value: job })}
                        >
                          Edit
                        </button>
                        <button
                          className="button danger small"
                          onClick={() =>
                            setModal({
                              type: "delete",
                              entity: "job",
                              id: job.id,
                            })
                          }
                        >
                          Delete
                        </button>
                      </div>
                      {data.runs
                        .filter((r) => r.application_id === job.id)
                        .map((r) => (
                          <button
                            key={r.id}
                            className="button secondary small"
                            onClick={() => setSelected(r.id)}
                          >
                            {r.status} ·{" "}
                            {new Date(r.created_at).toLocaleString()} · View run
                          </button>
                        ))}
                    </article>
                  ))}
              </div>
            )}
            {activeRun && (
              <section className="card" style={{ marginTop: 24 }}>
                <div
                  className="actions"
                  style={{ justifyContent: "space-between", marginBottom: 20 }}
                >
                  <h2 style={{ margin: 0 }}>Analysis & preparation</h2>
                  <button
                    className="button secondary small"
                    onClick={() => setSelected(null)}
                  >
                    Close run
                  </button>
                </div>
                <p className="tiny muted">
                  {activeRun.status} ·{" "}
                  {new Date(activeRun.created_at).toLocaleString()} ·{" "}
                  {activeRun.prompt_version} ·{" "}
                  {activeRun.provider ||
                    (activeRun.model === "none" ? "simulated" : "openai")}{" "}
                  · {activeRun.model} ·{" "}
                  {activeRun.status === "running" ||
                  activeRun.status === "pending"
                    ? "In progress"
                    : activeRun.duration_ms && activeRun.duration_ms > 0
                      ? `${activeRun.duration_ms} ms`
                      : "Duration not recorded"}
                </p>
                {activeRun.error && <p role="alert">{activeRun.error}</p>}
                {activeRun.output && (
                  <>
                    <p>{activeRun.output.summary}</p>
                    {activeRun.output.requirements.map((r) => (
                      <div className="list-row" key={r.id}>
                        <div className="grow">
                          <span className={`badge ${r.status}`}>
                            {activeRun.model === "none"
                              ? "Not assessed"
                              : r.status}
                          </span>
                          <h3 style={{ marginTop: 10 }}>{r.requirement}</h3>
                          <p className="tiny muted">{r.explanation}</p>
                          {r.evidenceIds.map((id) => {
                            const e = (activeRun.evidence_snapshot || []).find(
                              (x) => x.id === id,
                            );
                            return (
                              <div className="evidence" key={id}>
                                <strong>{e?.title || id}</strong>
                                <br />
                                {e?.body || "Evidence unavailable"}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <h3 style={{ marginTop: 24 }}>Interview questions</h3>
                    <ol>
                      {activeRun.output.questions.map((q, i) => (
                        <li key={i}>{q.text}</li>
                      ))}
                    </ol>
                    <h3>Proposed study tasks</h3>
                    {activeRun.output.tasks.map((t, i) => (
                      <div className="list-row" key={i}>
                        <div>
                          <strong>{t.title}</strong>
                          <p className="tiny muted">{t.detail}</p>
                        </div>
                      </div>
                    ))}
                    <button
                      className="button"
                      disabled={
                        busy ||
                        data.tasks.some((t) => t.run_id === activeRun.id)
                      }
                      onClick={() => approve(activeRun)}
                    >
                      {data.tasks.some((t) => t.run_id === activeRun.id)
                        ? "Plan approved"
                        : "Approve preparation plan"}
                    </button>
                    <p className="tiny muted" style={{ marginTop: 10 }}>
                      Approval saves these tasks. Review the evidence and
                      suggestions first.
                    </p>
                  </>
                )}
              </section>
            )}
          </>
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
                request(path, value, undefined, signal)
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
              request={async (source, signal) => {
                const response = await fetch("/api/resume/extract", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                  },
                  body: JSON.stringify(source),
                  signal,
                });
                const result = await response.json();
                if (!response.ok)
                  throw new Error(result.error || "Extraction failed");
                return result;
              }}
              confirm={confirmImport}
              close={() => setModal(null)}
            />
          ) : modal.type === "auth" ? (
            <>
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

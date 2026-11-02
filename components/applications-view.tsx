"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  fitCoverage,
  type Analysis,
  type Job,
  type Run,
  type Workspace as Data,
} from "@/lib/domain";

type Section = "jd" | "fit" | "plan";
const sections: { id: Section; label: string }[] = [
  { id: "jd", label: "Job description" },
  { id: "fit", label: "Fit analysis" },
  { id: "plan", label: "Prep plan" },
];
const statusLabel = {
  supported: "Met",
  partial: "Partial",
  unsupported: "Gap",
} as const;

const isSimulated = (run: Run) =>
  run.provider === "simulated" || run.model === "none";

function fitLabel(run: Run | undefined) {
  if (!run?.output) return "—";
  if (isSimulated(run)) return "Preview";
  const c = fitCoverage(run.output);
  return `${c.supported}/${c.total}`;
}

function runMeta(run: Run) {
  const when = new Date(run.created_at).toLocaleString();
  if (isSimulated(run)) return `Simulated preview · no model called · ${when}`;
  const duration =
    run.status === "running" || run.status === "pending"
      ? "in progress"
      : run.duration_ms && run.duration_ms > 0
        ? `${(run.duration_ms / 1000).toFixed(1)} s`
        : "duration not recorded";
  return `${run.provider || "openai"} · ${run.model} · ${when} · ${duration}`;
}

function OverflowMenu({
  label,
  items,
}: {
  label: string;
  items: {
    label: string;
    onSelect: () => void;
    danger?: boolean;
    disabled?: boolean;
  }[];
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent | globalThis.KeyboardEvent) => {
      const menu = ref.current;
      if (!menu?.open) return;
      if (event instanceof MouseEvent && menu.contains(event.target as Node))
        return;
      if (!(event instanceof MouseEvent) && event.key !== "Escape") return;
      menu.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details className="menu" ref={ref}>
      <summary className="button secondary icon-button" aria-label={label}>
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </svg>
      </summary>
      <div className="menu-list">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            className={item.danger ? "danger" : undefined}
            disabled={item.disabled}
            onClick={() => {
              if (ref.current) ref.current.open = false;
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </details>
  );
}

export function ApplicationsView({
  workspace,
  mode,
  busy,
  aiReady,
  runningJob,
  selectedRun,
  onSelectRun,
  onAnalyze,
  onPrepare,
  onEdit,
  onDelete,
  onApprove,
  onAdd,
}: {
  workspace: Data;
  mode: "demo" | "live";
  busy: boolean;
  aiReady: boolean;
  runningJob: string | null;
  selectedRun: string | null;
  onSelectRun: (id: string | null) => void;
  onAnalyze: (job: Job, simulated?: boolean) => void;
  onPrepare: (job: Job) => void;
  onEdit: (job: Job) => void;
  onDelete: (job: Job) => void;
  onApprove: (run: Run) => void;
  onAdd: () => void;
}) {
  const [search, setSearch] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("fit");
  const tabRefs = useRef<Record<Section, HTMLButtonElement | null>>({
    jd: null,
    fit: null,
    plan: null,
  });

  // A newly started or explicitly opened run should be visible immediately.
  useEffect(() => {
    if (selectedRun) setSection("fit");
  }, [selectedRun]);

  const runsFor = (id: string) =>
    workspace.runs
      .filter((r) => r.application_id === id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latestOutput = (id: string) => runsFor(id).find((r) => r.output);

  const jobs = workspace.jobs.filter((j) =>
    `${j.company} ${j.role}`.toLowerCase().includes(search.toLowerCase()),
  );
  const pinned = workspace.runs.find((r) => r.id === selectedRun);
  const job =
    workspace.jobs.find((j) => j.id === pinned?.application_id) ||
    workspace.jobs.find((j) => j.id === jobId) ||
    jobs[0];

  if (workspace.jobs.length === 0)
    return (
      <div className="empty">
        <h2>Your search starts here.</h2>
        <p className="muted">
          Add a job description to build a preparation plan.
        </p>
        <button className="button" onClick={onAdd}>
          Add your first application
        </button>
      </div>
    );

  const runs = job ? runsFor(job.id) : [];
  const run = pinned?.application_id === job?.id ? pinned : runs[0];
  const approved = !!run && workspace.tasks.some((t) => t.run_id === run.id);
  const running = !!job && runningJob === job.id;

  function selectJob(id: string) {
    setJobId(id);
    onSelectRun(null);
  }
  function tabKey(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = sections.findIndex((s) => s.id === section);
    const next = sections[(index + step + sections.length) % sections.length];
    setSection(next.id);
    tabRefs.current[next.id]?.focus();
  }

  const analyzeButton = job && (
    <button
      className="button green"
      disabled={busy || !aiReady}
      title={aiReady ? undefined : "The configured model is not available"}
      onClick={() => onAnalyze(job)}
    >
      {running
        ? "Analyzing…"
        : runs.some((r) => !isSimulated(r))
          ? "Re-run fit analysis"
          : "Analyze fit"}
    </button>
  );

  const approveBar = run?.output && (
    <div className="approve-bar">
      <p className="tiny">
        {approved
          ? "Plan approved. Its tasks are in Preparation tasks."
          : `Draft plan: ${run.output.questions.length} questions, ${run.output.tasks.length} study tasks. Nothing is saved until you approve.`}
      </p>
      <div className="actions">
        {section !== "plan" && (
          <button
            className="button secondary"
            onClick={() => setSection("plan")}
          >
            Review plan
          </button>
        )}
        <button
          className="button accent"
          disabled={busy || approved}
          onClick={() => onApprove(run)}
        >
          {approved ? "Plan approved" : "Approve plan"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="apps">
      <section className="apps-list" aria-label="Applications">
        <label className="tiny muted" htmlFor="search">
          Search company or role
        </label>
        <input
          id="search"
          className="search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
        />
        {jobs.length === 0 && (
          <p className="tiny muted">No applications match “{search}”.</p>
        )}
        {jobs.map((j) => (
          <button
            key={j.id}
            className={`apps-row ${j.id === job?.id ? "active" : ""}`}
            aria-pressed={j.id === job?.id}
            onClick={() => selectJob(j.id)}
          >
            <span className="apps-row-role">{j.role}</span>
            <span className="apps-row-meta">
              <span className="badge">{j.stage}</span>
              <span className="apps-row-company">{j.company}</span>
              <span className="apps-row-fit">
                {runningJob === j.id ? "…" : fitLabel(latestOutput(j.id))}
              </span>
            </span>
          </button>
        ))}
      </section>

      {job && (
        <section className="card apps-detail" aria-label="Selected application">
          <div className="apps-detail-top">
            <div>
              <p className="job-company">
                <span className="badge">{job.stage}</span> {job.company}
              </p>
              <h2>{job.role}</h2>
              {job.notes && <p className="tiny muted">{job.notes}</p>}
            </div>
            <div className="actions">
              {analyzeButton}
              <OverflowMenu
                label="More actions"
                items={[
                  {
                    label: "Prepare for this job",
                    onSelect: () => onPrepare(job),
                    disabled: busy,
                  },
                  ...(mode === "demo"
                    ? [
                        {
                          label: "Simulated preview (no model)",
                          onSelect: () => onAnalyze(job, true),
                          disabled: busy,
                        },
                      ]
                    : []),
                  { label: "Edit application", onSelect: () => onEdit(job) },
                  {
                    label: "Delete application",
                    onSelect: () => onDelete(job),
                    danger: true,
                  },
                ]}
              />
            </div>
          </div>
          {!aiReady && (
            <p className="tiny muted">
              Analysis needs a configured model. Check the status in the header,
              or use a simulated preview from the ⋯ menu.
            </p>
          )}

          <div
            className="apps-tabs"
            role="tablist"
            aria-label="Application sections"
            onKeyDown={tabKey}
          >
            {sections.map((s) => (
              <button
                key={s.id}
                ref={(el) => {
                  tabRefs.current[s.id] = el;
                }}
                id={`apps-tab-${s.id}`}
                role="tab"
                aria-selected={section === s.id}
                aria-controls="apps-panel"
                tabIndex={section === s.id ? 0 : -1}
                className={section === s.id ? "selected" : undefined}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div
            id="apps-panel"
            role="tabpanel"
            aria-labelledby={`apps-tab-${section}`}
            className="apps-panel"
          >
            {section === "jd" && <p className="jd-text">{job.jd}</p>}

            {section === "fit" && !run && (
              <div className="empty slim">
                <h3>No fit analysis yet.</h3>
                <p className="tiny muted">
                  Compare this job description with your confirmed experience.
                  Nothing is saved as a plan until you approve it.
                </p>
                {analyzeButton}
              </div>
            )}

            {section === "fit" && run && (
              <>
                <div className="run-meta">
                  <p className="tiny muted">{runMeta(run)}</p>
                  {runs.length > 1 && (
                    <label className="tiny muted">
                      Run{" "}
                      <select
                        value={run.id}
                        onChange={(e) => onSelectRun(e.target.value)}
                      >
                        {runs.map((r) => (
                          <option key={r.id} value={r.id}>
                            {new Date(r.created_at).toLocaleString()} ·{" "}
                            {isSimulated(r) ? "simulated" : r.status}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {(run.status === "running" || run.status === "pending") && (
                  <p role="status" className="notice">
                    Analysis running. You can review other applications while
                    you wait.
                  </p>
                )}
                {run.error && (
                  <p role="alert" className="notice error">
                    {run.error}
                  </p>
                )}
                {run.output && <FitResult run={run} output={run.output} />}
                {approveBar}
              </>
            )}

            {section === "plan" &&
              (run?.output ? (
                <>
                  <h3>Interview questions</h3>
                  <ol className="plan-questions">
                    {run.output.questions.map((q, i) => (
                      <li key={i}>{q.text}</li>
                    ))}
                  </ol>
                  <h3>Proposed study tasks</h3>
                  {run.output.tasks.map((t, i) => (
                    <div className="list-row" key={i}>
                      <span className="index">0{i + 1}</span>
                      <div className="grow">
                        <strong>{t.title}</strong>
                        <p className="tiny muted">{t.detail}</p>
                      </div>
                    </div>
                  ))}
                  {approveBar}
                </>
              ) : (
                <div className="empty slim">
                  <h3>No plan yet.</h3>
                  <p className="tiny muted">
                    A fit analysis drafts interview questions and study tasks
                    for you to review.
                  </p>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

function FitResult({ run, output }: { run: Run; output: Analysis }) {
  const simulated = isSimulated(run);
  const coverage = fitCoverage(output);
  const evidence = run.evidence_snapshot || [];
  return (
    <>
      {simulated ? (
        <p className="coverage-note">{output.summary}</p>
      ) : (
        <div className="coverage">
          <div>
            <div className="coverage-score">
              {coverage.supported}
              <span> / {coverage.total}</span>
            </div>
            <p className="tiny muted">requirements fully met</p>
          </div>
          <div className="coverage-bar-wrap">
            <div
              className="coverage-bar"
              role="img"
              aria-label={`${coverage.supported} met, ${coverage.partial} partial, ${coverage.unsupported} gaps`}
            >
              {coverage.supported > 0 && (
                <span className="met" style={{ flex: coverage.supported }} />
              )}
              {coverage.partial > 0 && (
                <span className="partial" style={{ flex: coverage.partial }} />
              )}
              {coverage.unsupported > 0 && (
                <span className="gap" style={{ flex: coverage.unsupported }} />
              )}
            </div>
            <p className="tiny coverage-legend" aria-hidden="true">
              <span>● {coverage.supported} met</span>
              <span>◐ {coverage.partial} partial</span>
              <span>○ {coverage.unsupported} gap</span>
            </p>
          </div>
        </div>
      )}
      {!simulated && <p>{output.summary}</p>}
      <div className="table-wrap">
        <table className="fit-table">
          <thead>
            <tr>
              <th scope="col">Requirement</th>
              <th scope="col">Status</th>
              <th scope="col">Your evidence</th>
            </tr>
          </thead>
          <tbody>
            {output.requirements.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.requirement}
                  <p className="tiny muted">{r.explanation}</p>
                </td>
                <td>
                  <span
                    className={`chip ${simulated ? "unassessed" : r.status}`}
                  >
                    {simulated ? "Not assessed" : statusLabel[r.status]}
                  </span>
                </td>
                <td>
                  {r.evidenceIds.length === 0 ? (
                    <span className="tiny muted">
                      {simulated ? "—" : "No confirmed evidence"}
                    </span>
                  ) : (
                    r.evidenceIds.map((id) => {
                      const e = evidence.find((x) => x.id === id);
                      return (
                        <details className="evidence-item" key={id}>
                          <summary>{e?.title || id}</summary>
                          <p className="tiny">
                            {e?.body || "Evidence unavailable"}
                          </p>
                        </details>
                      );
                    })
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

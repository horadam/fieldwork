"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  fitCoverage,
  type Analysis,
  type Job,
  type Run,
  type Workspace as Data,
} from "@/lib/domain";
import { usageLabel } from "@/lib/pricing";
import type { PlanSummary } from "@/lib/preparation-plan";
import { signupsOpen } from "@/lib/deployment";
import type { AiStatus } from "./hooks/use-ai-status";
import { CostHint } from "./ui/cost-hint";
import { OverflowMenu } from "./ui/overflow-menu";

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
  const usage =
    run.input_tokens || run.output_tokens
      ? ` · ${usageLabel({
          provider: run.provider || "openai",
          model: run.model,
          inputTokens: run.input_tokens || 0,
          outputTokens: run.output_tokens || 0,
        })}`
      : "";
  return `${run.provider || "openai"} · ${run.model} · ${when} · ${duration}${usage}`;
}

export function ApplicationsView({
  workspace,
  mode,
  busy,
  aiReady,
  ai,
  runningJob,
  selectedRun,
  onSelectRun,
  onAnalyze,
  onPrepare,
  onEdit,
  onDelete,
  onOpenTarget,
  preparation = [],
  onAdd,
}: {
  workspace: Data;
  mode: "demo" | "live";
  busy: boolean;
  aiReady: boolean;
  ai?: AiStatus | null;
  runningJob: string | null;
  selectedRun: string | null;
  onSelectRun: (id: string | null) => void;
  onAnalyze: (job: Job, simulated?: boolean) => void;
  onPrepare: (job: Job) => void;
  onEdit: (job: Job) => void;
  onDelete: (job: Job) => void;
  // Opens a preparation target from the Prep plan tab.
  onOpenTarget: (targetId: string) => void;
  // Each preparation target's plan state, reported by the preparation workspace.
  preparation?: PlanSummary[];
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
          {!aiReady ? (
            <p className="tiny muted">
              Analysis needs a model.{" "}
              {signupsOpen()
                ? "Sign in, or add your own OpenAI key from the status in the header."
                : "Add your own OpenAI key from the status in the header."}{" "}
              You can also use a simulated preview from the ⋯ menu.
            </p>
          ) : (
            <CostHint
              ai={ai ?? null}
              step="analysis"
              sourceChars={
                job.jd.length +
                workspace.experience.reduce(
                  (n, e) => n + e.title.length + e.body.length,
                  0,
                )
              }
            />
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
                  The analysis shows which requirements your experience meets.
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
              </>
            )}

            {section === "plan" && (
              <PrepPlan
                summaries={preparation.filter((t) => t.jobIds.includes(job.id))}
                hasRealAnalysis={runs.some(
                  (r) => r.status === "completed" && !isSimulated(r),
                )}
                busy={busy}
                onPrepare={() => onPrepare(job)}
                onOpenTarget={onOpenTarget}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// This job's preparation plans, from "Prepare for this job". Analyses no
// longer carry a separately approved plan.
function PrepPlan({
  summaries,
  hasRealAnalysis,
  busy,
  onPrepare,
  onOpenTarget,
}: {
  summaries: PlanSummary[];
  hasRealAnalysis: boolean;
  busy: boolean;
  onPrepare: () => void;
  onOpenTarget: (targetId: string) => void;
}) {
  if (!summaries.length)
    return (
      <div className="empty slim">
        <h3>No preparation plan yet</h3>
        <p className="tiny muted">
          Prepare for this job turns its fit analysis into interview questions
          and practice activities, scheduled around the time you have.
          {!hasRealAnalysis && " It needs a completed real analysis first."}
        </p>
        <button className="button" disabled={busy} onClick={onPrepare}>
          Prepare for this job
        </button>
      </div>
    );
  return (
    <div>
      {summaries.map((s) => (
        <div className="list-row" key={s.targetId}>
          <div className="grow">
            <strong>{s.name}</strong>
            <p className="tiny muted">
              {s.plan
                ? `Active plan from ${new Date(s.plan.createdAt).toLocaleDateString()} · ${s.plan.questions} questions · ${s.plan.remaining} of ${s.plan.scheduled} scheduled activities left`
                : "No active plan yet. Generate and review one in Interview practice."}
            </p>
          </div>
          <button
            className="button secondary small"
            onClick={() => onOpenTarget(s.targetId)}
          >
            Open preparation
          </button>
        </div>
      ))}
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

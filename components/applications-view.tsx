"use client";
import { useEffect, useState } from "react";
import { Tabs, tabPanelProps } from "./ui/tabs";
import { Meta, dateTime } from "./ui/meta";
import {
  fitCoverage,
  type Analysis,
  type Job,
  type AnalysisRun,
  type Workspace as Data,
} from "@/lib/domain";
import { usageParts } from "@/lib/pricing";
import {
  analysisProblem,
  matchingAnalysisRun,
  type PlanSummary,
} from "@/lib/preparation-plan";
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

const isSimulated = (analysisRun: AnalysisRun) =>
  analysisRun.provider === "simulated" || analysisRun.model === "none";

// Short fit summary for a list row; null when the job has no analysis yet.
export function fitLabel(analysisRun: AnalysisRun | undefined) {
  if (!analysisRun?.output) return null;
  if (isSimulated(analysisRun)) return "Preview";
  const c = fitCoverage(analysisRun.output);
  return `${c.supported}/${c.total}`;
}

// The facts about one analysis run, rendered as a Meta row.
export function analysisRunMeta(analysisRun: AnalysisRun): string[] {
  const when = dateTime(analysisRun.created_at);
  if (isSimulated(analysisRun))
    return ["Simulated preview", "no model called", when];
  const duration =
    analysisRun.status === "running" || analysisRun.status === "pending"
      ? "in progress"
      : analysisRun.duration_ms && analysisRun.duration_ms > 0
        ? `${(analysisRun.duration_ms / 1000).toFixed(1)} s`
        : "duration not recorded";
  const usage =
    analysisRun.input_tokens || analysisRun.output_tokens
      ? usageParts({
          provider: analysisRun.provider || "openai",
          model: analysisRun.model,
          inputTokens: analysisRun.input_tokens || 0,
          outputTokens: analysisRun.output_tokens || 0,
        })
      : [];
  return [
    analysisRun.provider || "openai",
    analysisRun.model,
    when,
    duration,
    ...usage,
  ];
}

const statusChip = (label: string) => (
  <span className="chip quiet">{label}</span>
);
const notAnalyzed = statusChip("Not analyzed");

export function ApplicationsView({
  workspace,
  mode,
  busy,
  aiReady,
  ai,
  analyzingJobId,
  selectedAnalysisRunId,
  onSelectAnalysisRun,
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
  analyzingJobId: string | null;
  selectedAnalysisRunId: string | null;
  onSelectAnalysisRun: (id: string | null) => void;
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

  // A newly started or explicitly opened analysis should be visible immediately.
  useEffect(() => {
    if (selectedAnalysisRunId) setSection("fit");
  }, [selectedAnalysisRunId]);

  const analysisRunsFor = (id: string) =>
    workspace.runs
      .filter((r) => r.application_id === id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latestOutput = (id: string) =>
    analysisRunsFor(id).find((analysisRun) => analysisRun.output);

  const jobs = workspace.jobs.filter((j) =>
    `${j.company} ${j.role}`.toLowerCase().includes(search.toLowerCase()),
  );
  const selectedAnalysisRun = workspace.runs.find(
    (analysisRun) => analysisRun.id === selectedAnalysisRunId,
  );
  const job =
    workspace.jobs.find((j) => j.id === selectedAnalysisRun?.application_id) ||
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

  const analysisRuns = job ? analysisRunsFor(job.id) : [];
  const analysisRun =
    selectedAnalysisRun?.application_id === job?.id
      ? selectedAnalysisRun
      : analysisRuns[0];
  const analysisInProgress = !!job && analyzingJobId === job.id;

  function selectJob(id: string) {
    setJobId(id);
    onSelectAnalysisRun(null);
  }

  const analyzeButton = job && (
    <button
      className="button green"
      disabled={busy || !aiReady}
      title={aiReady ? undefined : "The configured model is not available"}
      onClick={() => onAnalyze(job)}
    >
      {analysisInProgress
        ? "Analyzing…"
        : analysisRuns.some((analysisRun) => !isSimulated(analysisRun))
          ? "Re-run fit analysis"
          : "Analyze fit"}
    </button>
  );

  const activePrep = preparation.find(
    (p) => p.jobIds.includes(job?.id ?? "") && p.plan,
  );
  const fresh = job && matchingAnalysisRun(job.id, workspace);
  // A completed real analysis that no longer matches the JD or experience bank.
  const stale =
    !!job &&
    !fresh &&
    analysisRuns.some(
      (analysisRun) =>
        analysisRun.status === "completed" &&
        analysisRun.output &&
        !isSimulated(analysisRun),
    );
  const jobPlans = job
    ? preparation.filter((t) => t.jobIds.includes(job.id))
    : [];
  // The visible empty state already carries the next action with its
  // explanation, so the header shows status instead of a second button.
  const emptyCarriesAction =
    !activePrep &&
    ((section === "fit" && !analysisRun) ||
      (section === "plan" && !jobPlans.length && !fresh));
  const nextAction =
    job &&
    (activePrep ? (
      <button
        className="button green"
        onClick={() => onOpenTarget(activePrep.targetId)}
      >
        Continue preparation
      </button>
    ) : fresh ? (
      <button
        className="button green"
        disabled={busy}
        onClick={() => onPrepare(job)}
      >
        Create preparation plan
      </button>
    ) : (
      analyzeButton
    ));
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
                {analyzingJobId === j.id
                  ? "…"
                  : (fitLabel(latestOutput(j.id)) ?? notAnalyzed)}
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
              {emptyCarriesAction
                ? stale
                  ? statusChip("Analysis out of date")
                  : notAnalyzed
                : nextAction}
              <OverflowMenu
                label="More actions"
                items={[
                  {
                    label: "Re-run fit analysis",
                    onSelect: () => onAnalyze(job),
                    disabled: busy || !aiReady,
                  },
                  {
                    label: "Prepare for this job",
                    onSelect: () => onPrepare(job),
                    disabled: busy,
                  },
                  // Only for browser-mode visitors without a usable model.
                  ...(mode === "demo" && !aiReady
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
          {stale && (
            <p className="notice">{analysisProblem(job.id, workspace)}</p>
          )}
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

          <Tabs
            id="apps"
            label="Application sections"
            items={sections}
            value={section}
            onChange={setSection}
          />

          <div {...tabPanelProps("apps", section)} className="apps-panel">
            {section === "jd" && <p className="jd-text">{job.jd}</p>}

            {section === "fit" && !analysisRun && (
              <div className="empty slim">
                <h3>No fit analysis yet.</h3>
                <p className="tiny muted">
                  Compare this job description with your confirmed experience.
                  The analysis shows which requirements your experience meets.
                </p>
                {nextAction}
              </div>
            )}

            {section === "fit" && analysisRun && (
              <>
                <div className="analysis-run-meta">
                  <Meta items={analysisRunMeta(analysisRun)} />
                  {analysisRuns.length > 1 && (
                    <label className="tiny muted">
                      Analysis run{" "}
                      <select
                        value={analysisRun.id}
                        onChange={(e) =>
                          onSelectAnalysisRun(e.target.value || null)
                        }
                      >
                        {analysisRuns.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {dateTime(candidate.created_at)} ·{" "}
                            {isSimulated(candidate)
                              ? "simulated"
                              : candidate.status}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {(analysisRun.status === "running" ||
                  analysisRun.status === "pending") && (
                  <p role="status" className="notice">
                    Analysis running. You can review other applications while
                    you wait.
                  </p>
                )}
                {analysisRun.error && (
                  <p role="alert" className="notice error">
                    {analysisRun.error}
                  </p>
                )}
                {analysisRun.output && (
                  <FitResult
                    analysisRun={analysisRun}
                    output={analysisRun.output}
                  />
                )}
              </>
            )}

            {section === "plan" && (
              <PrepPlan
                summaries={jobPlans}
                problem={analysisProblem(job.id, workspace)}
                analyzeButton={analyzeButton}
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
  problem,
  analyzeButton,
  busy,
  onPrepare,
  onOpenTarget,
}: {
  summaries: PlanSummary[];
  // Why there is no current real analysis; null when one exists.
  problem: string | null;
  analyzeButton: React.ReactNode;
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
        </p>
        {/* Without a current analysis, preparing would only send the user back here. */}
        {problem ? (
          <>
            <p className="tiny muted">{problem}</p>
            {analyzeButton}
          </>
        ) : (
          <button className="button" disabled={busy} onClick={onPrepare}>
            Prepare for this job
          </button>
        )}
      </div>
    );
  return (
    <div>
      {summaries.map((s) => (
        <div className="list-row" key={s.targetId}>
          <div className="grow">
            <strong>{s.name}</strong>
            {s.plan ? (
              <Meta
                items={[
                  `Active plan from ${new Date(s.plan.createdAt).toLocaleDateString()}`,
                  `${s.plan.questions} questions`,
                  `${s.plan.remaining} of ${s.plan.scheduled} activities left`,
                ]}
              />
            ) : (
              <p className="tiny muted">
                No active plan yet. Generate and review one in Interview
                practice.
              </p>
            )}
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

function FitResult({
  analysisRun,
  output,
}: {
  analysisRun: AnalysisRun;
  output: Analysis;
}) {
  const simulated = isSimulated(analysisRun);
  const coverage = fitCoverage(output);
  const evidence = analysisRun.evidence_snapshot || [];
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

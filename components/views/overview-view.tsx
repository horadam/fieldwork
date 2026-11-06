"use client";
import type { Workspace } from "@/lib/domain";
import type { PlanSummary } from "@/lib/preparation-plan";
import { overviewSteps } from "@/lib/sample-practice";
import type { TabId } from "../shell/tabs";

export function OverviewView({
  context,
  onContinue,
  data,
  planSummaries,
  studyDone,
  studyTotal,
  onNavigate,
}: {
  context?: { name: string; next: string } | null;
  onContinue?: () => void;
  data: Workspace;
  planSummaries: PlanSummary[];
  studyDone: number;
  studyTotal: number;
  onNavigate: (tab: TabId) => void;
}) {
  return (
    <>
      <section className="card hero">
        <div className="eyebrow">Your next step</div>
        <h2>{context?.name || "Prepare for your next opportunity."}</h2>
        <p className="sub">
          {context?.next ||
            (data.experience.length === 0
              ? "Start by adding the experience you want to bring into your interviews."
              : "Choose an application, check your fit, and build a plan around your available time.")}
        </p>
        <button
          className="button accent"
          onClick={() =>
            context
              ? onContinue?.()
              : onNavigate(
                  data.experience.length === 0 ? "experience" : "applications",
                )
          }
        >
          {context
            ? "Continue preparation"
            : data.experience.length === 0
              ? "Add your experience"
              : "Choose an application"}
        </button>
      </section>
      <div className="stats">
        <div className="stat">
          <strong>{data.jobs.length}</strong>
          <span>Applications tracked</span>
        </div>
        <div className="stat">
          <strong>{data.experience.length}</strong>
          <span>Experience records</span>
        </div>
        <div className="stat">
          <strong>
            {planSummaries.reduce((n, s) => n + (s.plan?.remaining ?? 0), 0) +
              data.tasks.filter((t) => !t.done).length}
          </strong>
          <span>Preparation tasks to do</span>
        </div>
      </div>
      <details>
        <summary>General practice and sample roadmap</summary>
        <div className="grid">
          <section className="card">
            <div className="eyebrow">Your next three steps</div>
            <h2>Start with what matters.</h2>
            {overviewSteps.map((s, i) => (
              <div className="list-row" key={s.title}>
                <span className="index">{i + 1}</span>
                <div className="grow">
                  <h3>{s.title}</h3>
                  <p className="tiny muted">{s.detail}</p>
                </div>
                <button
                  className="button secondary small"
                  aria-label={`Open ${s.title}`}
                  onClick={() => onNavigate(s.target)}
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
            {/* Label and bar form one unit, so the bar reads as a meter. */}
            <div className="meter">
              <p className="tiny muted" id="study-progress-label">
                {studyDone} of {studyTotal} general study blocks completed
              </p>
              <div
                className="progress"
                role="progressbar"
                aria-labelledby="study-progress-label"
                aria-valuemin={0}
                aria-valuemax={studyTotal}
                aria-valuenow={studyDone}
              >
                <span
                  style={{
                    width: `${studyTotal ? (studyDone / studyTotal) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
            <button
              className="button secondary"
              onClick={() => onNavigate("study")}
            >
              Open study plan
            </button>
          </section>
        </div>
      </details>
    </>
  );
}

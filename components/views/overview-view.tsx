"use client";
import type { Workspace } from "@/lib/domain";
import { agendaMinutes, overviewSteps } from "@/lib/sample-practice";
import type { TabId } from "../shell/tabs";

export function OverviewView({
  data,
  studyDone,
  studyTotal,
  onNavigate,
}: {
  data: Workspace;
  studyDone: number;
  studyTotal: number;
  onNavigate: (tab: TabId) => void;
}) {
  return (
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
          <button
            className="button accent"
            onClick={() => onNavigate("practice")}
          >
            Start interview practice ↗
          </button>
          <span className="tag">{agendaMinutes}-minute sample prep plan</span>
        </div>
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
          <strong>{data.tasks.filter((t) => !t.done).length}</strong>
          <span>Approved tasks to work on</span>
        </div>
      </div>
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
            Six hours building, four practicing, two studying. Keep the feature
            scope small and the learning deliberate.
          </p>
          <div className="progress">
            <span
              style={{
                width: `${studyTotal ? (studyDone / studyTotal) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="tiny muted">
            {studyDone} of {studyTotal} general study blocks completed
          </p>
          <button
            className="button secondary"
            onClick={() => onNavigate("study")}
          >
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
  );
}

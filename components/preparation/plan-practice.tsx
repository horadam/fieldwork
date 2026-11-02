"use client";
import type {
  PreparationPlanVersion,
  PreparationProgress,
} from "@/lib/preparation-plan";
import { sourceLabels } from "./labels";

const rubric = ["Clarity", "Correctness", "Depth", "Tradeoffs", "Ownership"];

// Practice a plan question. Notes and scores autosave through `onChange`.
export function PlanPractice({
  plan,
  progress,
  questionId,
  onQuestion,
  readOnly,
  saveStatus,
  onChange,
}: {
  plan: PreparationPlanVersion;
  progress: PreparationProgress;
  questionId: string;
  onQuestion: (id: string) => void;
  readOnly: boolean;
  saveStatus: string;
  onChange: (next: PreparationProgress) => void;
}) {
  const question =
    plan.output.questions.find((q) => q.id === questionId) ||
    plan.output.questions[0];
  if (!question) return null;
  return (
    <section className="card form practice">
      <label>
        Practice question
        <select
          value={question.id}
          onChange={(e) => onQuestion(e.target.value)}
        >
          {plan.output.questions.map((q, i) => (
            <option key={q.id} value={q.id}>
              {i + 1}. {q.text}
            </option>
          ))}
        </select>
      </label>
      <h2>{question.text}</h2>
      <p className="tiny muted">{sourceLabels(question.refs, plan)}</p>
      <details>
        <summary>Suggested answer outline</summary>
        <p style={{ whiteSpace: "pre-wrap" }}>{question.outline}</p>
        {question.evidenceRefs.map((ref) => {
          const evidence = plan.sources
            .find((s) => s.jobId === ref.jobId)
            ?.evidenceSnapshot.find((e) => e.id === ref.evidenceId);
          return (
            <div className="evidence" key={`${ref.jobId}:${ref.evidenceId}`}>
              <strong>{evidence?.title}</strong>
              <p>{evidence?.body}</p>
            </div>
          );
        })}
      </details>
      <label>
        Your answer notes ·{" "}
        {readOnly ? "read-only previous version" : "saved automatically"}
        <textarea
          maxLength={12000}
          value={progress.answers[question.id] || ""}
          disabled={readOnly}
          onChange={(e) =>
            onChange({
              ...progress,
              answers: { ...progress.answers, [question.id]: e.target.value },
            })
          }
        />
      </label>
      <p className="tiny muted">
        Self-review only: 1 = weak, 3 = concrete but incomplete, 5 = clear and
        defensible. Notes do not complete rehearsal tasks.
      </p>
      <div className="score">
        {rubric.map((label) => (
          <label key={label}>
            {label}
            <select
              disabled={readOnly}
              value={progress.scores[question.id]?.[label] || ""}
              onChange={(e) => {
                const scores = { ...progress.scores[question.id] };
                if (e.target.value) scores[label] = Number(e.target.value);
                else delete scores[label];
                onChange({
                  ...progress,
                  scores: { ...progress.scores, [question.id]: scores },
                });
              }}
            >
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {!readOnly && (
        <p className="tiny muted" role="status">
          {saveStatus}
        </p>
      )}
    </section>
  );
}

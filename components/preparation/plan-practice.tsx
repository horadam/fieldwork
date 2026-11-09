"use client";
import type {
  PreparationPlanVersion,
  PreparationProgress,
} from "@/lib/preparation-plan";
import { useMemo, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import type { AiStatus } from "../hooks/use-ai-status";
import { CostHint } from "../ui/cost-hint";
import { Meta } from "../ui/meta";
import { SourceList } from "./source-list";
import { CoachFeedback } from "./coach-feedback";

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
  token,
  ai,
}: {
  plan: PreparationPlanVersion;
  progress: PreparationProgress;
  questionId: string;
  onQuestion: (id: string) => void;
  readOnly: boolean;
  saveStatus: string;
  onChange: (next: PreparationProgress) => void;
  token: string;
  ai?: AiStatus | null;
}) {
  const request = useMemo(() => apiClient(() => token), [token]);
  const [reviewing, setReviewing] = useState<string | null>(null),
    [reviewError, setReviewError] = useState(""),
    control = useRef<AbortController | null>(null);
  const question =
    plan.output.questions.find((q) => q.id === questionId) ||
    plan.output.questions[0];
  if (!question) return null;
  const notes = progress.answers[question.id] || "";
  const review = progress.reviews?.[question.id];
  const busy = reviewing === question.id;
  async function reviewMyNotes() {
    const id = question!.id;
    const abort = new AbortController();
    control.current = abort;
    setReviewing(id);
    setReviewError("");
    try {
      const result = await request<NonNullable<typeof review>>(
        "/api/practice/review",
        {
          signal: abort.signal,
          body: {
            planId: plan.id,
            questionId: id,
            notes,
            ...(!token ? { plan } : {}),
          },
        },
      );
      if (!abort.signal.aborted)
        onChange({
          ...progress,
          reviews: { ...progress.reviews, [id]: result },
        });
    } catch (e) {
      if (!abort.signal.aborted)
        setReviewError(
          e instanceof Error
            ? e.message
            : "The review failed. Your notes are unchanged.",
        );
    } finally {
      setReviewing(null);
      control.current = null;
    }
  }
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
      <p className="tiny muted">
        Question {plan.output.questions.indexOf(question) + 1} of{" "}
        {plan.output.questions.length}
      </p>
      <h2>{question.text}</h2>
      <div className="actions">
        <button
          className="button secondary small"
          disabled={plan.output.questions.indexOf(question) === 0}
          onClick={() =>
            onQuestion(
              plan.output.questions[plan.output.questions.indexOf(question) - 1]
                .id,
            )
          }
        >
          Previous question
        </button>
        <button
          className="button secondary small"
          disabled={
            plan.output.questions.indexOf(question) ===
            plan.output.questions.length - 1
          }
          onClick={() =>
            onQuestion(
              plan.output.questions[plan.output.questions.indexOf(question) + 1]
                .id,
            )
          }
        >
          Next question
        </button>
      </div>
      <SourceList refs={question.refs} plan={plan} />
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
          value={notes}
          disabled={readOnly || busy}
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
      <div className="notes-review">
        <h3>AI review of your notes</h3>
        {review ? (
          <div className="feedback">
            <CoachFeedback
              feedback={review.feedback}
              metadata={review.metadata}
            />
            <Meta
              items={[
                `Reviewed ${new Date(review.reviewedAt).toLocaleString()}`,
                review.notes.trim() !== notes.trim() &&
                  "Notes changed since this review",
              ]}
            />
          </div>
        ) : (
          <p className="tiny muted">
            One model call reviews these notes. The feedback is a suggestion and
            never changes your own scores.
          </p>
        )}
        {reviewError && (
          <p role="alert" className="notice error">
            {reviewError}
          </p>
        )}
        {!readOnly && (
          <>
            <div className="actions">
              {busy ? (
                <button
                  className="button secondary"
                  onClick={() => control.current?.abort()}
                >
                  Cancel review
                </button>
              ) : (
                <button
                  className="button secondary"
                  disabled={!notes.trim() || !ai?.ready || !!reviewing}
                  onClick={() => void reviewMyNotes()}
                >
                  {review ? "Review again" : "Review my notes"}
                </button>
              )}
              {busy && <span role="status">Reviewing…</span>}
            </div>
            <CostHint
              ai={ai ?? null}
              step="practice"
              sourceChars={notes.length + 8000}
            />
          </>
        )}
      </div>
    </section>
  );
}

"use client";
import { useState } from "react";
import {
  agendaMinutes,
  interviewQuestions,
  prepAgenda,
} from "@/lib/sample-practice";

const rubric = ["Clarity", "Correctness", "Depth", "Tradeoffs", "Ownership"];

// Practice against the sample question set when no target is selected.
export function GeneralPracticeView({
  answers,
  setAnswers,
  scores,
  setScores,
}: {
  answers: Record<number, string>;
  setAnswers: (next: Record<number, string>) => void;
  scores: Record<string, string>;
  setScores: (next: Record<string, string>) => void;
}) {
  const [question, setQuestion] = useState(0);
  const [showGuide, setShowGuide] = useState(false);
  const current = interviewQuestions[question];
  return (
    <>
      <div className="grid">
        <section className="card practice">
          <div className="eyebrow">
            Sample question {question + 1} of {interviewQuestions.length}
          </div>
          <h2>{current.question}</h2>
          <p className="tiny muted">
            Aim for 60–120 seconds. Answer before opening the guide.
          </p>
          <label htmlFor="answer" className="tiny">
            Your answer notes · saved automatically in this browser
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
              aria-expanded={showGuide}
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
          {showGuide && <div className="evidence">{current.guidance}</div>}
          <h3 style={{ marginTop: 25 }}>Self-review</h3>
          <p className="tiny muted">
            Score your actual answer. 1 = weak, 3 = concrete but incomplete, 5 =
            clear and defensible. This is not an automated assessment.
          </p>
          <div className="score">
            {rubric.map((label) => (
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
          <div className="eyebrow">General preparation · sample</div>
          <h2>Your {agendaMinutes}-minute preparation.</h2>
          {prepAgenda.map(([time, item]) => (
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
              Review your introduction and story outlines, ownership and metric
              caveats, then company/product notes and call setup.
            </p>
          </details>
        </section>
      </div>
      <section className="card">
        <h2>Evidence before confidence.</h2>
        <p className="quote">
          “One decision I influenced was… We considered… My contribution was…
          The evidence we had was…”
        </p>
        <p className="muted">
          Do not invent evaluation results, independent leadership, or the
          measurement behind a resume metric. Qualify what you cannot
          substantiate.
        </p>
      </section>
    </>
  );
}

"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PreparationPlanVersion } from "@/lib/preparation-plan";
import { apiClient } from "@/lib/api-client";
import {
  newSession,
  saveLocalSession,
  sessionSchema,
  validateSession,
  type PracticeSession,
} from "@/lib/practice-session";
import type { AiStatus } from "../hooks/use-ai-status";
import { CostHint } from "../ui/cost-hint";
import { usageLabel } from "@/lib/pricing";

const storageKey = "fieldwork-interviews-v1";
export function InterviewSession({
  plan,
  token,
  questionIds,
  activityId,
  readOnly,
  ai,
  onComplete,
  activityDone,
}: {
  plan: PreparationPlanVersion;
  token: string;
  questionIds: string[];
  activityId: string | null;
  readOnly: boolean;
  ai?: AiStatus | null;
  onComplete: (id: string) => void;
  activityDone: boolean;
}) {
  const request = useMemo(() => apiClient(() => token), [token]);
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<PracticeSession["mode"]>("coach");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PracticeSession | null>(null);
  const control = useRef<AbortController | null>(null);
  const session = pending || sessions.find((s) => s.id === selected);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const raw = token
          ? await request<unknown[]>(
              `/api/practice/sessions?planId=${plan.id}`,
              { signal: abort.signal },
            )
          : JSON.parse(localStorage.getItem(storageKey) || "[]");
        if (!Array.isArray(raw))
          throw new Error("Invalid saved practice data.");
        const all = raw
          .map((s) => sessionSchema.parse(s))
          .filter((s) => s.planId === plan.id)
          .map((s) => validateSession(s, plan));
        if (abort.signal.aborted) return;
        setSessions(all);
        setReady(true);
      } catch (e) {
        if (!abort.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Could not load practice attempts.",
          );
      }
    })();
    return () => {
      abort.abort();
      control.current?.abort();
    };
  }, [plan.id, request, token]);
  async function save(next: PracticeSession) {
    setPending(next);
    try {
      if (token)
        await request("/api/practice/sessions", {
          body: { planId: plan.id, session: next },
        });
      else {
        const all = JSON.parse(localStorage.getItem(storageKey) || "[]").map(
          (s: unknown) => sessionSchema.parse(s),
        );
        localStorage.setItem(
          storageKey,
          JSON.stringify(saveLocalSession(all, next)),
        );
      }
      setSessions((old) => [...old.filter((s) => s.id !== next.id), next]);
      setSelected(next.id);
      setPending(null);
      setAnswer("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Retry saving this attempt.",
      );
    }
  }
  async function start(ids: string[]) {
    setError("");
    setBusy(true);
    try {
      await save(
        newSession(
          plan,
          ids,
          mode,
          activityId &&
            ids.every((id) =>
              plan.output.activities
                .find((a) => a.id === activityId)
                ?.questionIds.includes(id),
            )
            ? activityId
            : null,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start interview.");
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!session || busy || pending) return;
    const abort = new AbortController();
    control.current = abort;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ session: PracticeSession }>(
        "/api/practice/turn",
        {
          signal: abort.signal,
          body: {
            planId: plan.id,
            sessionId: session.id,
            revision: session.revision,
            answer,
            ...(!token ? { plan, session } : {}),
          },
        },
      );
      if (!abort.signal.aborted)
        await save(validateSession(result.session, plan));
    } catch (e) {
      if (!abort.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Interview response failed. Your answer is retained.",
        );
    } finally {
      setBusy(false);
      control.current = null;
    }
  }
  const showFeedback =
    session?.mode === "coach" || session?.status === "completed";
  return (
    <section className="card form interview-session">
      <h2>
        Practice with an interviewer <span className="chip">Experimental</span>
      </h2>
      <p>
        One question at a time, with up to two follow-ups. Feedback is an AI
        suggestion, not a verified assessment. Your self-scores stay separate.
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {pending && (
        <div className="notice">
          <p>
            This attempt has not been saved. Retry saving without another model
            call.
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              await save(pending);
              setBusy(false);
            }}
          >
            Retry save
          </button>
        </div>
      )}
      {sessions.length > 0 && (
        <label>
          Attempt history
          <select
            disabled={busy || !!pending}
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setAnswer("");
              setError("");
            }}
          >
            <option value="">New attempt</option>
            {[...sessions].reverse().map((s) => (
              <option key={s.id} value={s.id}>
                {new Date(s.createdAt).toLocaleString()} · {s.mode} · {s.status}{" "}
                · {s.turns.length} answers
              </option>
            ))}
          </select>
        </label>
      )}
      {!session && !readOnly && (
        <>
          <label>
            Practice mode
            <select
              value={mode}
              onChange={(e) =>
                setMode(e.target.value as PracticeSession["mode"])
              }
            >
              <option value="coach">Coach · feedback after each answer</option>
              <option value="interview">Interview · feedback at the end</option>
            </select>
          </label>
          <div className="actions">
            <button
              className="button"
              disabled={!ready || busy || !ai?.ready}
              onClick={() => void start(questionIds.slice(0, 3))}
            >
              {questionIds.length > 1
                ? "Start these questions"
                : "Start this question"}
            </button>
            <button
              className="button secondary"
              disabled={!ready || busy || !ai?.ready}
              onClick={() =>
                void start(plan.output.questions.slice(0, 3).map((q) => q.id))
              }
            >
              Start short mock · up to 3 questions
            </button>
          </div>
          <p className="tiny muted">
            Each submitted answer makes one call to{" "}
            {ai?.provider || "the configured provider"} ·{" "}
            {ai?.model || "model unavailable"}. Up to nine calls per mock. No
            automatic retries. Starting an attempt makes no model call.
          </p>
        </>
      )}
      {session && (
        <>
          <p className="tiny muted">
            {session.mode === "coach" ? "Coach mode" : "Interview mode"} ·{" "}
            {session.questionIds.length} question
            {session.questionIds.length === 1 ? "" : "s"}
          </p>
          <ol className="conversation" aria-label="Interview transcript">
            {session.turns.map((t, i) => (
              <li key={t.id}>
                <p className="list-label">Interviewer · turn {i + 1}</p>
                <p>{t.prompt}</p>
                <p className="list-label">Your answer</p>
                <p className="answer-text">{t.answer}</p>
                {showFeedback && (
                  <details
                    open={
                      session.mode === "coach" && i === session.turns.length - 1
                    }
                  >
                    <summary>Coach feedback</summary>
                    {t.feedback.answerQuote && (
                      <blockquote>{t.feedback.answerQuote}</blockquote>
                    )}
                    <p>
                      <strong>Strength:</strong> {t.feedback.strength}
                    </p>
                    <p>
                      <strong>Try next:</strong> {t.feedback.improvement}
                    </p>
                    {t.feedback.caution && (
                      <p>
                        <strong>Check:</strong> {t.feedback.caution}
                      </p>
                    )}
                    <p className="tiny muted">{usageLabel(t.metadata)}</p>
                  </details>
                )}
              </li>
            ))}
          </ol>
          {session.status === "active" && !readOnly ? (
            <>
              <h3>{session.prompt}</h3>
              <label>
                Your interview answer
                <textarea
                  maxLength={6000}
                  value={answer}
                  disabled={busy || !!pending}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              </label>
              <CostHint ai={ai ?? null} step="practice" sourceChars={60000} />
              <div className="actions">
                <button
                  className="button"
                  disabled={busy || !!pending || !answer.trim() || !ai?.ready}
                  onClick={() => void submit()}
                >
                  Send answer
                </button>
                {busy && control.current && (
                  <button
                    className="button secondary"
                    onClick={() => control.current?.abort()}
                  >
                    Cancel response
                  </button>
                )}
                <button
                  className="button secondary"
                  disabled={busy || !!pending}
                  onClick={async () => {
                    setBusy(true);
                    await save({
                      ...session,
                      status: "completed",
                      prompt: "",
                      revision: session.revision + 1,
                    });
                    setBusy(false);
                  }}
                >
                  End interview and review
                </button>
              </div>
              {busy && (
                <p role="status">
                  Working… Your answer stays here if the request fails.
                </p>
              )}
            </>
          ) : (
            <>
              <h3>
                {readOnly ? "Previous plan · read-only" : "Session complete"}
              </h3>
              {session.turns.length === 0 && <p>No answers were submitted.</p>}
              {!readOnly && (
                <div className="actions">
                  <button
                    className="button"
                    disabled={busy || !!pending}
                    onClick={() => {
                      setSelected("");
                      setAnswer("");
                    }}
                  >
                    Try another attempt
                  </button>
                  {session.activityId && session.turns.length > 0 && (
                    <button
                      className="button secondary"
                      disabled={activityDone || busy || !!pending}
                      onClick={() => onComplete(session.activityId!)}
                    >
                      {activityDone
                        ? "Rehearsal completed"
                        : "Mark linked rehearsal complete"}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
      {!ready && !error && <p role="status">Loading attempts…</p>}
      {readOnly && !session && (
        <p>
          Select an earlier attempt to read it. Start new attempts on the active
          plan.
        </p>
      )}
    </section>
  );
}

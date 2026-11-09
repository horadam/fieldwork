"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
import { VoiceAnswer } from "./voice-answer";
import { ReadAloud } from "./read-aloud";
import { CoachFeedback } from "./coach-feedback";
import { CostHint } from "../ui/cost-hint";
import { Meta } from "../ui/meta";

const storageKey = "fieldwork-interviews-v1";
export function InterviewSession({
  plan,
  token,
  questionIds,
  activityId,
  readOnly,
  ai,
  onComplete,
  completedActivities,
}: {
  plan: PreparationPlanVersion;
  token: string;
  questionIds: string[];
  activityId: string | null;
  readOnly: boolean;
  ai?: AiStatus | null;
  onComplete: (id: string) => void;
  completedActivities: Record<string, boolean>;
}) {
  const request = useMemo(() => apiClient(() => token), [token]);
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<PracticeSession["mode"]>("coach");
  // The question a single-question attempt starts with; an activity's
  // linked questions start together instead.
  const [startId, setStartId] = useState(questionIds[0]);
  // Follow the question picked elsewhere (Self-assess, an activity link).
  useEffect(() => setStartId(questionIds[0]), [questionIds]);
  const linked = questionIds.length > 1;
  const startQuestions = (linked ? questionIds.slice(0, 3) : [startId])
    .map((id) => plan.output.questions.find((q) => q.id === id))
    .filter((q) => !!q);
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
  const active = session?.status === "active" && !readOnly;
  function addTranscript(text: string) {
    setAnswer((old) => (old.trim() ? `${old.trimEnd()}\n\n${text}` : text));
  }
  return (
    <section className="card form interview-session">
      <div className="interview-head">
        <h2>
          Mock interview <span className="chip">Experimental</span>
        </h2>
        {sessions.length > 0 && (
          <select
            aria-label="Attempt history"
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
        )}
      </div>
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
      {!session && !readOnly && (
        <>
          <p>
            Answer one question at a time, with up to two follow-ups each.
            Feedback is an AI suggestion, not a verified assessment, and stays
            separate from your self-scores.
          </p>
          {linked ? (
            <div>
              <p className="list-label">Questions in this rehearsal</p>
              <ol className="bullets">
                {startQuestions.map((q) => (
                  <li key={q.id}>{q.text}</li>
                ))}
              </ol>
            </div>
          ) : (
            <>
              <label>
                Question
                <select
                  value={startId}
                  onChange={(e) => setStartId(e.target.value)}
                >
                  {plan.output.questions.map((q, i) => (
                    <option key={q.id} value={q.id}>
                      {i + 1}. {q.text}
                    </option>
                  ))}
                </select>
              </label>
              {/* The picker cuts long questions off; show the full text. */}
              <p className="start-question">{startQuestions[0]?.text}</p>
            </>
          )}
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
              onClick={() => void start(startQuestions.map((q) => q.id))}
            >
              {linked ? "Start these questions" : "Start this question"}
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
          <Meta
            items={[
              ai?.provider || "No provider configured",
              ai?.model,
              "1 call per answer",
              "up to 9 per mock",
            ]}
          />
          <p className="tiny muted">
            Starting an attempt makes no model call, and failed calls are never
            retried automatically.
          </p>
        </>
      )}
      {session && (
        <>
          <Meta
            items={[
              session.mode === "coach" ? "Coach mode" : "Interview mode",
              `${session.questionIds.length} question${session.questionIds.length === 1 ? "" : "s"}`,
              `${session.turns.length} answered`,
              !active && (readOnly ? "Read-only" : "Complete"),
            ]}
          />
          <ol className="chat" aria-label="Interview transcript">
            {session.turns.map((t, i) => (
              <Fragment key={t.id}>
                <li className="bubble interviewer">
                  <span className="speaker">Interviewer</span>
                  <p>{t.prompt}</p>
                </li>
                <li className="bubble you">
                  <span className="speaker">You</span>
                  <p className="answer-text">{t.answer}</p>
                </li>
                {showFeedback && (
                  <li className="feedback">
                    <details
                      open={
                        session.mode === "coach" &&
                        i === session.turns.length - 1
                      }
                    >
                      <summary>Coach feedback</summary>
                      <CoachFeedback
                        feedback={t.feedback}
                        metadata={t.metadata}
                      />
                    </details>
                  </li>
                )}
              </Fragment>
            ))}
            {active && (
              <li className="bubble interviewer current">
                <span className="speaker">
                  Interviewer <ReadAloud text={session.prompt} />
                </span>
                <p>{session.prompt}</p>
              </li>
            )}
            {busy && active && (
              <li className="bubble interviewer typing" role="status">
                <span className="speaker">Interviewer</span>
                <p>Thinking… your answer stays here if the request fails.</p>
              </li>
            )}
            {!active && session.turns.length === 0 && (
              <li className="chat-empty">No answers were submitted.</li>
            )}
          </ol>
          {active ? (
            <div className="composer">
              <textarea
                aria-label="Your interview answer"
                placeholder="Type your answer, or record it"
                maxLength={6000}
                value={answer}
                disabled={busy || !!pending}
                onChange={(e) => setAnswer(e.target.value)}
              />
              <div className="composer-bar">
                <VoiceAnswer
                  key={`${session.id}:${session.revision}`}
                  request={request}
                  enabled={ai?.provider === "openai" && !!ai?.ready}
                  disabled={busy || !!pending}
                  onTranscript={addTranscript}
                  userKey={ai?.source === "user"}
                />
                <div className="composer-send">
                  <button
                    className="button secondary small"
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
                  {busy && control.current ? (
                    <button
                      className="button secondary"
                      onClick={() => control.current?.abort()}
                    >
                      Cancel response
                    </button>
                  ) : (
                    <button
                      className="button"
                      disabled={
                        busy || !!pending || !answer.trim() || !ai?.ready
                      }
                      onClick={() => void submit()}
                    >
                      Send answer
                    </button>
                  )}
                </div>
              </div>
              <CostHint ai={ai ?? null} step="practice" sourceChars={60000} />
            </div>
          ) : (
            !readOnly && (
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
                    disabled={
                      !!completedActivities[session.activityId] ||
                      busy ||
                      !!pending
                    }
                    onClick={() => onComplete(session.activityId!)}
                  >
                    {completedActivities[session.activityId]
                      ? "Rehearsal completed"
                      : "Mark linked rehearsal complete"}
                  </button>
                )}
              </div>
            )
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

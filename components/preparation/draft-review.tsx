"use client";
import {
  schedulePlan,
  settingsSchema,
  type PreparationPlanVersion,
} from "@/lib/preparation-plan";
import { sourceLabels } from "./labels";
import { TimingFields } from "./timing-fields";

type Draft = PreparationPlanVersion;
type Question = Draft["output"]["questions"][number];
type Activity = Draft["output"]["activities"][number];

// Review and edit a generated plan before activating it; nothing is saved here.
export function DraftReview({
  draft,
  busy,
  onChange,
  onActivate,
  onDiscard,
}: {
  draft: Draft;
  busy: boolean;
  onChange: (next: Draft) => void;
  onActivate: () => void;
  onDiscard: () => void;
}) {
  const schedule = settingsSchema.safeParse(draft.settings).success
    ? schedulePlan(draft.output, draft.settings, draft.excludedActivityIds)
    : null;
  const title = (id: string) =>
    draft.output.activities.find((a) => a.id === id)!.title;
  const setQuestion = (index: number, change: Partial<Question>) =>
    onChange({
      ...draft,
      output: {
        ...draft.output,
        questions: draft.output.questions.map((item, i) =>
          i === index ? { ...item, ...change } : item,
        ),
      },
    });
  const setActivity = (index: number, change: Partial<Activity>) =>
    onChange({
      ...draft,
      output: {
        ...draft.output,
        activities: draft.output.activities.map((item, i) =>
          i === index ? { ...item, ...change } : item,
        ),
      },
    });
  return (
    <section className="card prep-review">
      <fieldset
        disabled={busy}
        className="prep-review-fields"
        aria-label="Review preparation plan"
      >
        <h2>Review your preparation plan</h2>
        <p>{draft.output.summary}</p>
        <p className="tiny muted">
          {draft.metadata.provider} · {draft.metadata.model} ·{" "}
          {draft.metadata.promptVersion} ·{" "}
          {(draft.metadata.durationMs / 1000).toFixed(1)} s
          {draft.metadata.outputTokens !== undefined &&
            ` · ${draft.metadata.inputTokens} in / ${draft.metadata.outputTokens} out tokens`}
        </p>
        <TimingFields
          value={draft.settings}
          onChange={(settings) => onChange({ ...draft, settings })}
          disabled={busy}
        />
        <h3>Questions and suggested outlines</h3>
        {draft.output.questions.map((q, index) => (
          <details key={q.id}>
            <summary>{q.text}</summary>
            <div className="form">
              <label>
                Question
                <textarea
                  value={q.text}
                  maxLength={700}
                  onChange={(e) => setQuestion(index, { text: e.target.value })}
                />
              </label>
              <label>
                Suggested answer outline
                <textarea
                  value={q.outline}
                  maxLength={1800}
                  onChange={(e) =>
                    setQuestion(index, { outline: e.target.value })
                  }
                />
              </label>
              <p className="tiny muted">{sourceLabels(q.refs, draft)}</p>
            </div>
          </details>
        ))}
        <h3>Activities</h3>
        {draft.output.activities.map((a, index) => (
          <fieldset
            className="prep-activity form"
            key={a.id}
            aria-label={`Activity ${index + 1}: ${a.title}`}
          >
            <label className="prep-member">
              <input
                type="checkbox"
                checked={!draft.excludedActivityIds.includes(a.id)}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    excludedActivityIds: e.target.checked
                      ? draft.excludedActivityIds.filter((id) => id !== a.id)
                      : [...draft.excludedActivityIds, a.id],
                  })
                }
              />
              Include activity {index + 1}
            </label>
            <label>
              Title
              <input
                maxLength={200}
                value={a.title}
                onChange={(e) => setActivity(index, { title: e.target.value })}
              />
            </label>
            <label>
              Instructions
              <textarea
                maxLength={1500}
                value={a.detail}
                onChange={(e) => setActivity(index, { detail: e.target.value })}
              />
            </label>
            <div className="twocol">
              <label>
                Minutes
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={a.minutes}
                  onChange={(e) =>
                    setActivity(index, { minutes: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Priority
                <select
                  value={a.priority}
                  onChange={(e) =>
                    setActivity(index, { priority: Number(e.target.value) })
                  }
                >
                  {[1, 2, 3].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="tiny muted">{sourceLabels(a.refs, draft)}</p>
          </fieldset>
        ))}
        <h3>Schedule preview</h3>
        {schedule ? (
          <>
            <p>
              {schedule.used} / {schedule.capacity} minutes allocated.
            </p>
            {schedule.weeks.map((week, i) => (
              <p className="tiny" key={week.start}>
                Week {i + 1} · {week.start}–{week.end} · {week.used}/
                {week.capacity} min:{" "}
                {week.activityIds.map(title).join("; ") || "No activities fit."}
              </p>
            ))}
            <p className="tiny">
              Deferred: {schedule.deferred.map(title).join("; ") || "None"}
            </p>
          </>
        ) : (
          <p>Choose valid dates and weekly hours to preview the schedule.</p>
        )}
        <div className="actions">
          <button
            className="button accent"
            disabled={busy || !schedule}
            onClick={onActivate}
          >
            Activate plan
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={onDiscard}
          >
            Discard draft
          </button>
        </div>
        <p className="tiny muted">
          Activation preserves earlier versions and starts fresh progress.
          Failed saves retain this review.
        </p>
      </fieldset>
    </section>
  );
}

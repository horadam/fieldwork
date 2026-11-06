"use client";
import { usageLabel } from "@/lib/pricing";
import {
  schedulePlan,
  settingsSchema,
  type PreparationPlanVersion,
} from "@/lib/preparation-plan";
import { SourceList } from "./source-list";
import { Meta, dateRange } from "../ui/meta";
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
  const minutes = (id: string) =>
    draft.output.activities.find((a) => a.id === id)!.minutes;
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
        <details>
          <summary>Generation details</summary>
          <Meta
            items={[
              `${draft.metadata.provider} · ${draft.metadata.model}`,
              draft.metadata.promptVersion,
              `${(draft.metadata.durationMs / 1000).toFixed(1)} s`,
              draft.metadata.outputTokens !== undefined &&
                usageLabel({
                  provider: draft.metadata.provider,
                  model: draft.metadata.model,
                  inputTokens: draft.metadata.inputTokens ?? 0,
                  outputTokens: draft.metadata.outputTokens,
                }),
            ]}
          />
        </details>
        {!!draft.metadata.repairs?.length && (
          <div className="notice" role="status">
            <strong>Some of the model&apos;s links were removed.</strong> The
            plan only keeps links to requirements and experience that exist, so
            check that nothing important is missing.
            <ul>
              {draft.metadata.repairs.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}
        <TimingFields
          value={draft.settings}
          onChange={(settings) => onChange({ ...draft, settings })}
          disabled={busy}
        />
        <h3>Schedule preview</h3>
        {schedule ? (
          <>
            <div className="meter">
              <p className="tiny muted" id="draft-schedule-label">
                {schedule.used} of {schedule.capacity} minutes allocated
              </p>
              <div
                className="progress"
                role="progressbar"
                aria-labelledby="draft-schedule-label"
                aria-valuemin={0}
                aria-valuemax={schedule.capacity}
                aria-valuenow={schedule.used}
              >
                <span
                  style={{
                    width: `${schedule.capacity ? (schedule.used / schedule.capacity) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
            {schedule.weeks.map((week, i) => (
              <div className="week" key={week.start}>
                <div className="week-head">
                  <h4>Week {i + 1}</h4>
                  <Meta
                    items={[
                      dateRange(week.start, week.end),
                      `${week.used} / ${week.capacity} min`,
                    ]}
                  />
                </div>
                {week.activityIds.length ? (
                  <ol className="week-items">
                    {week.activityIds.map((id) => (
                      <li key={id}>
                        <span>{title(id)}</span>
                        <span>{minutes(id)} min</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="tiny muted">No activities fit this week.</p>
                )}
              </div>
            ))}
            <div className="week">
              <div className="week-head">
                <h4>Deferred</h4>
                <Meta items={["Doesn't fit the time available"]} />
              </div>
              {schedule.deferred.length ? (
                <ul className="week-items">
                  {schedule.deferred.map((id) => (
                    <li key={id}>
                      <span>{title(id)}</span>
                      <span>{minutes(id)} min</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tiny muted">Nothing deferred.</p>
              )}
            </div>
          </>
        ) : (
          <p>Choose valid dates and weekly hours to preview the schedule.</p>
        )}
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
              <SourceList refs={q.refs} plan={draft} />
            </div>
          </details>
        ))}
        <p className="notice">
          {draft.output.questions.length} questions ·{" "}
          {draft.output.activities.length - draft.excludedActivityIds.length}{" "}
          selected activities ·{" "}
          {schedule
            ? `${Number((schedule.used / 60).toFixed(1))} hours scheduled`
            : "Choose valid timing"}
          . Expand an activity to edit it.
        </p>
        <h3>Activities</h3>
        {draft.output.activities.map((a, index) => (
          <details key={a.id}>
            <summary>
              {a.title} · {a.minutes} min
            </summary>
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
                  onChange={(e) =>
                    setActivity(index, { title: e.target.value })
                  }
                />
              </label>
              <label>
                Instructions
                <textarea
                  maxLength={1500}
                  value={a.detail}
                  onChange={(e) =>
                    setActivity(index, { detail: e.target.value })
                  }
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
              <SourceList refs={a.refs} plan={draft} />
            </fieldset>
          </details>
        ))}
        <div className="actions review-actions">
          <button
            className="button accent"
            disabled={busy || !schedule}
            onClick={onActivate}
          >
            Start using this plan
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
          Starting this plan preserves earlier versions and begins fresh
          progress. Failed saves retain this review.
        </p>
      </fieldset>
    </section>
  );
}

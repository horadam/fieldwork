"use client";
import type {
  PreparationPlanVersion,
  PreparationProgress,
} from "@/lib/preparation-plan";
import { Meta } from "../ui/meta";
import { SourceList } from "./source-list";

// "coding_design" → "Coding design".
export const activityLabel = (type: string) => {
  const words = type.replaceAll("_", " ");
  return words[0].toUpperCase() + words.slice(1);
};

// Plan activities as checkboxes; each change saves immediately.
export function ActivityChecklist({
  plan,
  ids,
  progress,
  disabled,
  savingId,
  onToggle,
  onPractice,
}: {
  plan: PreparationPlanVersion;
  ids: string[];
  progress: PreparationProgress;
  disabled: boolean;
  // Only the activity being saved is disabled.
  savingId?: string | null;
  onToggle: (id: string, done: boolean) => void;
  onPractice?: (questionIds: string[], activityId: string) => void;
}) {
  if (!ids.length) return <p className="tiny muted">No matching activities.</p>;
  return (
    <>
      {ids.map((id) => {
        const activity = plan.output.activities.find((a) => a.id === id)!;
        return (
          <div className="check" key={id}>
            <input
              aria-label={`Complete ${activity.title}`}
              type="checkbox"
              disabled={disabled || savingId === id}
              checked={progress.done[id] || false}
              onChange={(e) => onToggle(id, e.target.checked)}
            />
            <div>
              <strong>{activity.title}</strong>
              <Meta
                items={[
                  `${activity.minutes} min`,
                  <span className="chip" key="type">
                    {activityLabel(activity.type)}
                  </span>,
                  `Priority ${activity.priority}`,
                ]}
              />
              <p>{activity.detail}</p>
              {activity.questionIds.length > 0 && (
                <div>
                  <p className="list-label">Practice questions</p>
                  <ul className="bullets tiny">
                    {activity.questionIds.map((q) => (
                      <li key={q}>
                        {onPractice ? (
                          <button
                            className="link"
                            onClick={() => onPractice([q], id)}
                          >
                            {
                              plan.output.questions.find((x) => x.id === q)
                                ?.text
                            }
                          </button>
                        ) : (
                          plan.output.questions.find((x) => x.id === q)?.text
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {onPractice && activity.questionIds.length > 0 && (
                <button
                  className="button secondary small"
                  onClick={() => onPractice(activity.questionIds, id)}
                >
                  Practice this activity’s questions
                </button>
              )}
              <SourceList refs={activity.refs} plan={plan} />
            </div>
          </div>
        );
      })}
    </>
  );
}

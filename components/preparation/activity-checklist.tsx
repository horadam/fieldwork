"use client";
import type {
  PreparationPlanVersion,
  PreparationProgress,
} from "@/lib/preparation-plan";
import { sourceLabels } from "./labels";

// Plan activities as checkboxes; each change saves immediately.
export function ActivityChecklist({
  plan,
  ids,
  progress,
  disabled,
  savingId,
  onToggle,
}: {
  plan: PreparationPlanVersion;
  ids: string[];
  progress: PreparationProgress;
  disabled: boolean;
  // Only the activity being saved is disabled.
  savingId?: string | null;
  onToggle: (id: string, done: boolean) => void;
}) {
  if (!ids.length) return <p className="tiny muted">No matching activities.</p>;
  return (
    <>
      {ids.map((id) => {
        const activity = plan.output.activities.find((a) => a.id === id)!;
        return (
          <label className="check" key={id}>
            <input
              type="checkbox"
              disabled={disabled || savingId === id}
              checked={progress.done[id] || false}
              onChange={(e) => onToggle(id, e.target.checked)}
            />
            <div>
              <strong>{activity.title}</strong>
              <p className="tiny muted">
                {activity.minutes} min · {activity.type.replaceAll("_", " ")} ·
                Priority {activity.priority}
              </p>
              <p>{activity.detail}</p>
              <p className="tiny muted">{sourceLabels(activity.refs, plan)}</p>
              {activity.questionIds.length > 0 && (
                <p className="tiny">
                  Practice questions:{" "}
                  {activity.questionIds
                    .map(
                      (q) =>
                        plan.output.questions.find((x) => x.id === q)?.text,
                    )
                    .join(" / ")}
                </p>
              )}
            </div>
          </label>
        );
      })}
    </>
  );
}

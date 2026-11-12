"use client";
import {
  schedulePlan,
  settingsSchema,
  type PlanSettings,
} from "@/lib/preparation-plan";

// Start date, horizon and weekly hours, with the resulting time budget.
export function TimingFields({
  value,
  onChange,
  disabled,
}: {
  value: PlanSettings;
  onChange: (next: PlanSettings) => void;
  disabled: boolean;
}) {
  const valid = settingsSchema.safeParse(value);
  const budget = valid.success
    ? schedulePlan({ summary: "", questions: [], activities: [] }, value)
    : null;
  return (
    <div className="form prep-timing">
      <div className="twocol">
        <label>
          Start date
          <input
            type="date"
            value={value.startDate}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, startDate: e.target.value })}
          />
        </label>
        <label>
          How long do you have?
          <select
            value={value.duration}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...value,
                duration: e.target.value as PlanSettings["duration"],
                deadline:
                  e.target.value === "deadline"
                    ? value.deadline || value.startDate
                    : null,
              })
            }
          >
            <option value="week">One week</option>
            <option value="two_weeks">Two weeks</option>
            <option value="deadline">Specific interview date</option>
          </select>
        </label>
      </div>
      {value.duration === "deadline" && (
        <label>
          Interview date (included)
          <input
            type="date"
            min={value.startDate}
            value={value.deadline || ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, deadline: e.target.value })}
          />
        </label>
      )}
      <label>
        Available hours per week
        <input
          type="number"
          min={0.5}
          max={40}
          step={0.5}
          value={value.hoursPerWeek}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...value, hoursPerWeek: Number(e.target.value) })
          }
        />
      </label>
      <p className="tiny muted">
        {budget
          ? `${Number((budget.capacity / 60).toFixed(1))} hours available over ${budget.weeks.length === 1 ? "one week" : `${budget.weeks.length} weeks`}.`
          : "Choose valid dates and 0.5–40 hours/week."}
      </p>
    </div>
  );
}

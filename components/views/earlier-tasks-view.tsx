"use client";
import type { Task } from "@/lib/domain";
import { EmptyState } from "../ui/empty-state";

// Preparation tasks with no target selected. Plan activities live with their
// target; this lists tasks approved from fit analyses before preparation
// plans replaced approval. Checkbox changes save immediately.
export function EarlierTasksView({
  tasks,
  savingTask,
  onToggle,
  onOpenApplications,
}: {
  tasks: Task[];
  savingTask: string | null;
  onToggle: (id: string, done: boolean) => void;
  onOpenApplications: () => void;
}) {
  if (!tasks.length)
    return (
      <EmptyState
        title="Your tasks come from a preparation plan."
        action={{ label: "Open applications", onClick: onOpenApplications }}
      >
        Choose Prepare for this job on an application to build a plan. Select
        its target above to see its activities here, week by week.
      </EmptyState>
    );
  return (
    <section className="card">
      <h3>Earlier analysis tasks</h3>
      <p className="tiny muted">
        Approved from fit analyses before preparation plans. Select a target
        above to see its plan activities.
      </p>
      {tasks.map((task) => (
        <label className={`check ${task.done ? "done" : ""}`} key={task.id}>
          <input
            type="checkbox"
            disabled={savingTask === task.id}
            checked={task.done}
            onChange={(e) => onToggle(task.id, e.target.checked)}
          />
          <div>
            <strong className="task-title">{task.title}</strong>
            <p className="tiny muted">{task.detail}</p>
          </div>
        </label>
      ))}
    </section>
  );
}

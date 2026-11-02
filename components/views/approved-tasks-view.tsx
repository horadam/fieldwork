"use client";
import type { Task } from "@/lib/domain";
import { EmptyState } from "../ui/empty-state";

// Tasks from analyses the user approved; checkbox changes save immediately.
export function ApprovedTasksView({
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
        title="Your plan is yours to approve."
        action={{ label: "Open applications", onClick: onOpenApplications }}
      >
        Analyze an application, review the proposed tasks, and approve a plan.
      </EmptyState>
    );
  return (
    <section className="card">
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

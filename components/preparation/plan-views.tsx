"use client";
import { Meta, dateRange } from "../ui/meta";
import { useState } from "react";
import type { Workspace } from "@/lib/domain";
import {
  schedulePlan,
  type PreparationPlanVersion,
  type PreparationProgress,
  type PreparationTarget,
} from "@/lib/preparation-plan";
import { ActivityChecklist, activityLabel } from "./activity-checklist";

type Schedule = ReturnType<typeof schedulePlan>;
type Checklist = {
  plan: PreparationPlanVersion;
  progress: PreparationProgress;
  disabled: boolean;
  savingId: string | null;
  onToggle: (id: string, done: boolean) => void;
};
const activityTypes = [
  "study",
  "coding_design",
  "story_rehearsal",
  "question_practice",
];

// Study plan tab: the plan's activities week by week, with filters by job,
// activity type and status. Filtering keeps the weeks and hides what
// doesn't match.
export function PlanSchedule({
  schedule,
  ...checklist
}: Checklist & { schedule: Schedule }) {
  const { plan, progress } = checklist;
  const [job, setJob] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const filtering = !!(job || type || status);
  const matches = (id: string) => {
    const a = plan.output.activities.find((x) => x.id === id)!;
    return (
      (!job || a.refs.some((r) => r.jobId === job)) &&
      (!type || a.type === type) &&
      (!status || !!progress.done[id] === (status === "done"))
    );
  };
  const completed = plan.output.activities
    .filter(
      (a) =>
        progress.done[a.id] &&
        schedule.weeks.some((w) => w.activityIds.includes(a.id)),
    )
    .reduce((n, a) => n + a.minutes, 0);
  return (
    <>
      <section className="card">
        <Meta
          items={[
            `${schedule.used} / ${schedule.capacity} minutes scheduled`,
            `${completed} estimated minutes completed`,
          ]}
        />
        <div className="actions">
          {plan.sources.length > 1 && (
            <label>
              Job{" "}
              <select value={job} onChange={(e) => setJob(e.target.value)}>
                <option value="">All jobs</option>
                {plan.sources.map((s) => (
                  <option key={s.jobId} value={s.jobId}>
                    {s.company} · {s.role}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Activity{" "}
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {activityTypes.map((t) => (
                <option key={t} value={t}>
                  {activityLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status{" "}
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="todo">To do</option>
              <option value="done">Completed</option>
            </select>
          </label>
        </div>
      </section>
      {schedule.weeks.map((week, i) => {
        const ids = week.activityIds.filter(matches);
        if (filtering && !ids.length) return null;
        return (
          <section className="card" key={week.start}>
            <h2>Week {i + 1}</h2>
            <Meta
              items={[
                dateRange(week.start, week.end),
                `${week.used} / ${week.capacity} minutes`,
              ]}
            />
            {ids.length ? (
              <ActivityChecklist {...checklist} ids={ids} />
            ) : (
              <p>No activities fit this week.</p>
            )}
          </section>
        );
      })}
      <DeferredCoverage
        {...checklist}
        schedule={schedule}
        ids={schedule.deferred.filter(matches)}
      />
    </>
  );
}

function DeferredCoverage({
  schedule,
  ids,
  ...checklist
}: Checklist & { schedule: Schedule; ids: string[] }) {
  const { plan } = checklist;
  return (
    <section className="card">
      <h3>Deferred · outside the schedule</h3>
      {schedule.deferred.length ? (
        <ActivityChecklist {...checklist} ids={ids} />
      ) : (
        <p>No selected activities were deferred.</p>
      )}
      <h3>Requirements without scheduled work</h3>
      {plan.sources.flatMap((source) =>
        source.analysis.requirements
          .filter((r) => !schedule.covered.has(`${source.jobId}:${r.id}`))
          .map((r) => (
            <p className="tiny" key={`${source.jobId}:${r.id}`}>
              {source.company} · {r.requirement}
            </p>
          )),
      )}
      <p className="tiny muted">
        Scheduled coverage does not establish skill mastery or complete
        interview readiness.
      </p>
    </section>
  );
}

// Tasks approved from fit analyses of this target's jobs, before plans
// replaced approval.
export function EarlierTasks({
  target,
  workspace,
  savingTask,
  onToggle,
}: {
  target: PreparationTarget;
  workspace: Workspace;
  savingTask: string | null;
  onToggle: (id: string, done: boolean) => void;
}) {
  const tasks = workspace.tasks.filter((task) =>
    workspace.runs.some(
      (run) =>
        run.id === task.run_id && target.jobIds.includes(run.application_id),
    ),
  );
  // Approving analysis tasks was retired; earlier ones stay usable here.
  if (!tasks.length) return null;
  return (
    <section className="card">
      <h3>Earlier analysis tasks</h3>
      <p className="tiny muted">
        These remain separate from plan scheduling totals.
      </p>
      {tasks.map((task) => (
        <label className="check" key={task.id}>
          <input
            type="checkbox"
            disabled={savingTask === task.id}
            checked={task.done}
            onChange={(e) => onToggle(task.id, e.target.checked)}
          />
          <div>
            <strong>{task.title}</strong>
            <p>{task.detail}</p>
          </div>
        </label>
      ))}
    </section>
  );
}

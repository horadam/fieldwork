"use client";
import { useId, useState, type FormEvent } from "react";
import type { Job } from "@/lib/domain";

// Starts (or reopens) preparation for one application, the same as
// "Prepare for this job" in Applications.
export function RolePicker({
  jobs,
  busy,
  onPick,
  onCancel,
}: {
  jobs: Job[];
  busy: boolean;
  onPick: (jobId: string) => void;
  onCancel: () => void;
}) {
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const id = useId();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (jobId) onPick(jobId);
  }
  return (
    <form className="form prep-editor" onSubmit={submit}>
      <h3>Prepare for a role</h3>
      {jobs.length ? (
        <label htmlFor={id}>
          Role
          <select
            id={id}
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            disabled={busy}
          >
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.company} · {job.role}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="tiny muted">Add an application first.</p>
      )}
      <div className="actions">
        <button className="button" disabled={busy || !jobId}>
          Start preparing
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

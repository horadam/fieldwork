"use client";
import { useRef, useState, type FormEvent } from "react";
import type { Job } from "@/lib/domain";
import {
  defaultSettings,
  type PreparationTarget,
} from "@/lib/preparation-plan";
import { TimingFields } from "./timing-fields";

// Create or edit a target. The form keeps its own copy of the fields, so
// cancelling leaves the selected target's settings untouched.
export function TargetEditor({
  target,
  jobs,
  busy,
  onSave,
  onCancel,
}: {
  target?: PreparationTarget;
  jobs: Job[];
  busy: boolean;
  onSave: (value: PreparationTarget) => void;
  onCancel: () => void;
}) {
  // Stable for this form, so a retried save does not create a second target.
  const id = useRef(target?.id || crypto.randomUUID());
  const [name, setName] = useState(target?.name || "");
  const [members, setMembers] = useState<string[]>(target?.jobIds || []);
  const [settings, setSettings] = useState(
    target?.settings || defaultSettings(),
  );
  const [problem, setProblem] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!members.length || members.length > 3)
      return setProblem("Choose one to three applications.");
    setProblem("");
    onSave({
      id: id.current,
      name,
      jobIds: members,
      settings,
      activeVersionId: target?.activeVersionId || null,
    });
  }
  return (
    <form className="form prep-editor" onSubmit={submit}>
      <h3>{target ? "Edit target" : "Create preparation group"}</h3>
      {problem && (
        <p role="alert" className="notice error">
          {problem}
        </p>
      )}
      <label>
        Target name
        <input
          required
          maxLength={160}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
      </label>
      <fieldset>
        <legend>Choose one to three applications</legend>
        {!jobs.length && (
          <p className="tiny muted">
            Add an application first; targets group one to three of them.
          </p>
        )}
        {members
          .filter((member) => !jobs.some((j) => j.id === member))
          .map((member) => (
            <label className="prep-member" key={member}>
              <input
                type="checkbox"
                checked
                onChange={() => setMembers(members.filter((m) => m !== member))}
              />
              Deleted application · deselect to repair
            </label>
          ))}
        {jobs.map((job) => (
          <label className="prep-member" key={job.id}>
            <input
              type="checkbox"
              disabled={
                busy || (!members.includes(job.id) && members.length >= 3)
              }
              checked={members.includes(job.id)}
              onChange={(e) =>
                setMembers(
                  e.target.checked
                    ? [...members, job.id]
                    : members.filter((m) => m !== job.id),
                )
              }
            />
            {job.company} · {job.role}
          </label>
        ))}
      </fieldset>
      <TimingFields value={settings} onChange={setSettings} disabled={busy} />
      <div className="actions">
        <button className="button" disabled={busy}>
          Save target
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

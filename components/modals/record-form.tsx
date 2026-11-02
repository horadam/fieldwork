"use client";
import { useState, type FormEvent } from "react";
import {
  experienceInput,
  jobInput,
  MAX_JD_CHARS,
  stageSchema,
  type Experience,
  type Job,
} from "@/lib/domain";
import type { RecordValue } from "@/lib/store";

export type RecordForm =
  | { entity: "job"; value?: Job }
  | { entity: "experience"; value?: Experience };

// Add or edit a job or experience entry; validation matches the server's.
export function RecordFormBody({
  form,
  busy,
  onSave,
  onCancel,
}: {
  form: RecordForm;
  busy: boolean;
  onSave: (value: RecordValue) => void;
  onCancel: () => void;
}) {
  const [invalid, setInvalid] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const parsed =
      form.entity === "job"
        ? jobInput.safeParse({
            company: fields.get("company"),
            role: fields.get("role"),
            jd: fields.get("jd"),
            stage: fields.get("stage"),
            notes: fields.get("notes"),
          })
        : experienceInput.safeParse({
            title: fields.get("title"),
            body: fields.get("body"),
          });
    setInvalid(!parsed.success);
    if (parsed.success) onSave(parsed.data);
  }
  return (
    <form className="form" onSubmit={submit}>
      {invalid && (
        <p role="alert" className="notice error">
          Check the field limits: titles up to 160 characters, details 10–5,000,
          job descriptions 20–{MAX_JD_CHARS.toLocaleString("en-US")}.
        </p>
      )}
      {form.entity === "job" ? (
        <>
          <div className="twocol">
            <label>
              Company
              <input
                name="company"
                defaultValue={form.value?.company}
                maxLength={160}
                required
              />
            </label>
            <label>
              Role
              <input
                name="role"
                defaultValue={form.value?.role}
                maxLength={160}
                required
              />
            </label>
          </div>
          <label>
            Stage
            <select name="stage" defaultValue={form.value?.stage || "Saved"}>
              {stageSchema.options.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Job description
            <textarea
              name="jd"
              defaultValue={form.value?.jd}
              minLength={20}
              maxLength={MAX_JD_CHARS}
              required
              placeholder="Paste the requirements here…"
            />
          </label>
          <label>
            Notes
            <textarea
              name="notes"
              defaultValue={form.value?.notes || ""}
              maxLength={4000}
              style={{ minHeight: 70 }}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            Experience title
            <input
              name="title"
              defaultValue={form.value?.title}
              maxLength={160}
              required
              placeholder="Project or delivery example"
            />
          </label>
          <label>
            User-confirmed details
            <textarea
              name="body"
              defaultValue={form.value?.body}
              minLength={10}
              maxLength={5000}
              required
              placeholder="User problem, your contribution, tradeoffs, and defensible outcomes…"
            />
          </label>
        </>
      )}
      <div className="actions">
        <button className="button" disabled={busy}>
          Save {form.entity === "job" ? "application" : "experience"}
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

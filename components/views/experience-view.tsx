"use client";
import type { Experience } from "@/lib/domain";
import { EmptyState } from "../ui/empty-state";

export function ExperienceView({
  experience,
  busy,
  onAdd,
  onImport,
  onEdit,
  onDelete,
}: {
  experience: Experience[];
  busy: boolean;
  onAdd: () => void;
  onImport: () => void;
  onEdit: (entry: Experience) => void;
  onDelete: (entry: Experience) => void;
}) {
  return (
    <>
      {experience.length === 0 && (
        <EmptyState
          title="Start with a real example."
          action={{ label: "Import resume", onClick: onImport, disabled: busy }}
        >
          Add a project you can discuss, including your contribution and
          outcome, or import roles from your resume and confirm each one.{" "}
          <button className="link" onClick={onAdd}>
            Add one by hand
          </button>
          .
        </EmptyState>
      )}
      {experience.map((e) => (
        <article className="card" key={e.id}>
          <h2>{e.title}</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{e.body}</p>
          {e.provenance && (
            <details>
              <summary>Resume import details</summary>
              <p className="tiny muted">
                {e.provenance.organization} · {e.provenance.role} ·{" "}
                {e.provenance.dates || "Dates not supplied"}
                <br />
                {e.provenance.provider} · {e.provenance.model} ·{" "}
                {e.provenance.promptVersion}
              </p>
              <p className="tiny muted">
                Details reviewed and confirmed by the user.
              </p>
            </details>
          )}
          <div className="actions">
            <button
              className="button secondary small"
              aria-label={`Edit ${e.title}`}
              onClick={() => onEdit(e)}
            >
              Edit experience
            </button>
            <button
              className="button danger small"
              aria-label={`Delete ${e.title}`}
              onClick={() => onDelete(e)}
            >
              Delete
            </button>
          </div>
        </article>
      ))}
      <p className="tiny muted">
        Use user-confirmed facts. Analysis runs retain the evidence snapshot
        used at generation time.
      </p>
    </>
  );
}

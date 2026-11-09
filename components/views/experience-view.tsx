"use client";
import type { Experience } from "@/lib/domain";
import { EmptyState } from "../ui/empty-state";
import { Meta } from "../ui/meta";

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
          <ExperienceBody entry={e} />
          {e.provenance && (
            <details>
              <summary>Resume import details</summary>
              <Meta
                items={[
                  e.provenance.organization,
                  e.provenance.role,
                  e.provenance.dates || "Dates not supplied",
                ]}
              />
              <Meta
                items={[
                  `Extracted with ${e.provenance.provider} · ${e.provenance.model}`,
                  e.provenance.promptVersion,
                ]}
              />
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

// Imported entries store their dates as the first line and one
// accomplishment per line; show the dates as metadata and the rest as a list.
function ExperienceBody({ entry }: { entry: Experience }) {
  const lines = entry.body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const dates =
    entry.provenance?.dates && lines[0] === entry.provenance.dates
      ? lines.shift()
      : undefined;
  return (
    <>
      {dates && <Meta items={[dates]} />}
      {lines.length > 1 ? (
        <ul className="bullets">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : (
        <p style={{ whiteSpace: "pre-wrap" }}>{lines[0] ?? entry.body}</p>
      )}
    </>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import {
  validateExtraction,
  draftExperience,
  reviewDrafts,
  importSchema,
  likelyDuplicate,
  resumeSource,
  type Draft,
  type ImportBatch,
  type ResumeSource,
  type ReviewDraft,
} from "@/lib/resume";
import type { Experience } from "@/lib/domain";
import type { Provenance } from "@/lib/resume";
import { parseResumePdf } from "@/lib/pdf-browser";

type Review = ReviewDraft;
type Metadata = {
  provider: "ollama" | "openai";
  model: string;
  promptVersion: string;
  durationMs: number;
};
export function ResumeImport({
  existing,
  provider,
  request,
  confirm,
  close,
}: {
  existing: Experience[];
  provider: string;
  request: (
    source: ResumeSource,
    signal: AbortSignal,
  ) => Promise<{ drafts: Draft[]; warnings: string[]; metadata: Metadata }>;
  confirm: (batch: ImportBatch) => Promise<void>;
  close: () => void;
}) {
  const [step, setStep] = useState<"input" | "inspect" | "review">("input");
  const [text, setText] = useState(""),
    [source, setSource] = useState<ResumeSource>({ text: "", pages: [] });
  const [warnings, setWarnings] = useState<string[]>([]),
    [reviews, setReviews] = useState<Review[]>([]);
  const [metadata, setMetadata] = useState<Metadata | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const [inspected, setInspected] = useState(false);
  const [batchId] = useState(() => crypto.randomUUID());
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function cancel() {
    controller.current?.abort();
    close();
  }
  async function pdf(file?: File) {
    if (!file) return;
    setBusy("Reading PDF in this browser…");
    setError("");
    try {
      const result = await parseResumePdf(file);
      setSource(result.source);
      setWarnings(result.warnings);
      setInspected(false);
      setStep("inspect");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not read PDF. Paste text instead.",
      );
    } finally {
      setBusy("");
    }
  }
  async function generate() {
    setError("");
    setBusy(
      `Generating drafts with ${provider}. Local inference can take up to three minutes…`,
    );
    const control = new AbortController();
    controller.current = control;
    try {
      const result = await request(resumeSource.parse(source), control.signal);
      setMetadata(result.metadata);
      setWarnings(result.warnings);
      setReviews(reviewDrafts(result.drafts, existing));
      setStep("review");
    } catch (e) {
      if (!control.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Extraction failed. Retry after checking configuration.",
        );
    } finally {
      setBusy("");
      controller.current = null;
    }
  }
  const selected = reviews.filter((r) => r.selected);
  const capacity = existing.length + selected.length > 50;
  async function save() {
    setError("");
    setBusy("Saving selected user-confirmed experience…");
    try {
      if (!metadata) throw new Error("Generate drafts first.");
      validateExtraction(
        { drafts: selected.map((r) => r.draft), warnings: [] },
        source,
      );
      const entries = selected.map((r) => ({
        itemId: r.id,
        title: r.title,
        body: r.body,
        provenance: {
          kind: r.draft.kind,
          organization: r.draft.organization,
          role: r.draft.role,
          dates: r.draft.dates,
          provider: metadata.provider,
          model: metadata.model,
          promptVersion: metadata.promptVersion,
          confirmedAt: new Date().toISOString(),
        } satisfies Provenance,
      }));
      await confirm(importSchema.parse({ batchId, entries }));
      close();
    } catch (e) {
      setError(
        e instanceof Error && !("issues" in e)
          ? e.message
          : "Check selected titles and details (10–5,000 characters). Drafts are retained for retry.",
      );
    } finally {
      setBusy("");
    }
  }
  function updateReview(previous: Review, next: Review) {
    const duplicate = likelyDuplicate(
      { ...next, provenance: next.draft },
      existing,
    );
    return {
      ...next,
      duplicate,
      selected: duplicate && !previous.duplicate ? false : next.selected,
    };
  }
  function edit(index: number, changes: Partial<Review>) {
    setReviews((old) =>
      old.map((r, i) =>
        i === index ? updateReview(r, { ...r, ...changes }) : r,
      ),
    );
  }
  function editField(
    index: number,
    key: "organization" | "role" | "dates",
    value: string,
  ) {
    setReviews((old) =>
      old.map((r, i) => {
        if (i !== index) return r;
        const draft = { ...r.draft, [key]: value },
          before = draftExperience(r.draft),
          after = draftExperience(draft);
        return updateReview(r, {
          ...r,
          draft,
          title: r.title === before.title ? after.title : r.title,
          body: r.body === before.body ? after.body : r.body,
        });
      }),
    );
  }
  return (
    <section className="resume-import" aria-label="Resume import">
      <div className="actions">
        <span className="badge">
          {step === "input"
            ? "1 · Choose input"
            : step === "inspect"
              ? "2 · Inspect source"
              : "3 · Review and confirm"}
        </span>
        <span className="tiny muted">{provider}</span>
      </div>
      <p className="tiny muted">
        Drafts stay in memory until you confirm. Only selected entries are
        saved. Your PDF is never uploaded.
      </p>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {busy && (
        <div className="notice" role="status">
          {busy}
        </div>
      )}
      {step === "input" && (
        <div className="form">
          <label>
            Text-based PDF · one file, up to 5 MB and ten pages
            <input
              disabled={!!busy}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                void pdf(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <p className="tiny muted">
            Scanned documents and DOCX are not supported. Paste readable text
            instead.
          </p>
          <label>
            Or paste resume text · up to 20,000 characters
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste roles, dates, accomplishments, and explicitly listed projects…"
            />
          </label>
          <span className="tiny">
            {text.length.toLocaleString()} / 20,000 characters
          </span>
          <button
            className="button"
            disabled={!!busy || text.trim().length < 30 || text.length > 20000}
            onClick={() => {
              setSource({ text: text.trim(), pages: [] });
              setWarnings([]);
              setInspected(false);
              setStep("inspect");
            }}
          >
            Inspect text
          </button>
        </div>
      )}
      {step === "inspect" && (
        <>
          <div className="notice">
            Only the text shown below will be sent to {provider}. Check that
            nothing is missing or out of order.
          </div>
          {warnings.map((w, i) => (
            <p className="tiny" key={i}>
              {w}
            </p>
          ))}
          <pre className="resume-source">{source.text}</pre>
          <label className="check">
            <input
              type="checkbox"
              checked={inspected}
              onChange={(e) => setInspected(e.target.checked)}
              disabled={!!busy}
            />
            I inspected the extracted text and want to generate drafts.
          </label>
          <div className="actions">
            <button
              className="button"
              disabled={!inspected || !!busy}
              onClick={generate}
            >
              Generate experience drafts
            </button>
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => {
                setText(source.text);
                setStep("input");
              }}
            >
              Back / correct text
            </button>
          </div>
        </>
      )}
      {step === "review" && (
        <>
          <p>
            Review each draft against its source. These become{" "}
            <strong>user-confirmed experience</strong>; check that the model’s
            interpretation matches your actual work.
          </p>
          {warnings.map((w, i) => (
            <p className="tiny" key={i}>
              {w}
            </p>
          ))}
          {!reviews.length && (
            <div className="notice">
              No explicit roles or projects were found. Correct the source text
              or add experience manually.
            </div>
          )}
          {reviews.map((r, index) => (
            <article className="card form" key={r.id}>
              <label className="import-select">
                <input
                  type="checkbox"
                  checked={r.selected}
                  onChange={(e) => edit(index, { selected: e.target.checked })}
                  disabled={!!busy}
                />
                {r.duplicate
                  ? "Import separately despite likely duplicate"
                  : "Import this entry"}
              </label>
              {r.duplicate && (
                <div className="notice">
                  Likely duplicate. Deselected by default; selecting it creates
                  a separate entry.
                </div>
              )}
              <div className="twocol">
                <label>
                  Employer / project
                  <input
                    maxLength={160}
                    value={r.draft.organization}
                    onChange={(e) =>
                      editField(index, "organization", e.target.value)
                    }
                  />
                </label>
                <label>
                  Role
                  <input
                    maxLength={160}
                    value={r.draft.role}
                    onChange={(e) => editField(index, "role", e.target.value)}
                  />
                </label>
              </div>
              <label>
                Dates as written
                <input
                  maxLength={160}
                  value={r.draft.dates}
                  onChange={(e) => editField(index, "dates", e.target.value)}
                />
              </label>
              <label>
                Saved experience title
                <input
                  maxLength={160}
                  value={r.title}
                  onChange={(e) => edit(index, { title: e.target.value })}
                />
              </label>
              <label>
                Saved details · edit dates and accomplishments here
                <textarea
                  maxLength={5000}
                  value={r.body}
                  onChange={(e) => edit(index, { body: e.target.value })}
                />
              </label>
              <details>
                <summary>Inspected resume text</summary>
                <pre className="resume-source">{source.text}</pre>
              </details>
              {r.draft.warnings.map((w, i) => (
                <p key={i} className="tiny muted">
                  {w}
                </p>
              ))}
            </article>
          ))}
          <p className={capacity ? "notice error" : "tiny muted"}>
            {selected.length} selected · {existing.length} / 50 existing entries
            {capacity ? " · Select fewer drafts before importing." : ""}
          </p>
          <div className="actions">
            <button
              className="button"
              disabled={!!busy || !selected.length || capacity}
              onClick={save}
            >
              Confirm import of {selected.length}{" "}
              {selected.length === 1 ? "entry" : "entries"}
            </button>
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => setStep("inspect")}
            >
              Back to source
            </button>
          </div>
          {metadata && (
            <p className="tiny muted">
              {metadata.provider} · {metadata.model} · {metadata.promptVersion}{" "}
              · {metadata.durationMs} ms
            </p>
          )}
        </>
      )}
      <button
        className="button secondary small"
        disabled={busy.startsWith("Saving")}
        style={{ marginTop: 18 }}
        onClick={cancel}
      >
        Cancel and discard drafts
      </button>
    </section>
  );
}

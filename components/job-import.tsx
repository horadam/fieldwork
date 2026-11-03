"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { jobInput, type Job } from "@/lib/domain";
import { usageLabel, type CallRecord } from "@/lib/pricing";
import type { AiStatus } from "./hooks/use-ai-status";
import { CostHint } from "./ui/cost-hint";

type Page = { url: string; title: string; text: string; warnings: string[] };
type Draft = {
  company: string;
  role: string;
  jd: string;
  warnings: string[];
  metadata?: CallRecord;
};
export function JobImport({
  provider,
  ai = null,
  request,
  confirm,
  close,
}: {
  provider: string;
  ai?: AiStatus | null;
  request: (
    path: string,
    value: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>;
  confirm: (job: Job) => Promise<void>;
  close: () => void;
}) {
  const [step, setStep] = useState<"input" | "inspect" | "review">("input");
  const [url, setUrl] = useState(""),
    [sourceUrl, setSourceUrl] = useState(""),
    [text, setText] = useState(""),
    [title, setTitle] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]),
    [draft, setDraft] = useState<Draft>({
      company: "",
      role: "",
      jd: "",
      warnings: [],
    });
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const [id] = useState(() => crypto.randomUUID());
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function execute(
    label: string,
    work: (signal: AbortSignal) => Promise<void>,
  ) {
    const control = new AbortController();
    controller.current = control;
    setBusy(label);
    setError("");
    try {
      await work(control.signal);
    } catch (e) {
      if (!control.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Import failed. Your text is retained.",
        );
    } finally {
      setBusy("");
      controller.current = null;
    }
  }
  function manual() {
    setDraft({ company: "", role: "", jd: text, warnings: [] });
    setStep("review");
    setError("");
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    await execute("Saving application…", async () => {
      const parsed = jobInput.safeParse({
        company: fields.get("company"),
        role: fields.get("role"),
        jd: fields.get("jd"),
        stage: "Saved",
        notes: sourceUrl ? `Source: ${sourceUrl}` : "",
      });
      if (!parsed.success)
        throw new Error(
          "Check company, role, and job description (20–15,000 characters).",
        );
      await confirm({ ...parsed.data, id });
      close();
    });
  }
  return (
    <div className="form">
      <p className="tiny muted">
        {step === "input"
          ? "1 · Choose input"
          : step === "inspect"
            ? "2 · Inspect source"
            : "3 · Review application"}{" "}
        · {provider}
      </p>
      <p className="tiny muted">
        Fetch a public listing, inspect its text, then extract and review the
        details. Nothing is saved until you confirm. Your experience bank is not
        sent.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {warnings.map((warning, i) => (
        <p className="tiny muted" key={i}>
          {warning}
        </p>
      ))}
      {step === "input" && (
        <>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void execute("Fetching public page…", async (signal) => {
                const page = (await request(
                  "/api/jobs/fetch",
                  { url },
                  signal,
                )) as Page;
                setText(page.text);
                setSourceUrl(page.url);
                setTitle(page.title);
                setWarnings(page.warnings);
                setStep("inspect");
              });
            }}
          >
            <label>
              Public job listing URL
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                maxLength={2048}
                required
                disabled={!!busy}
              />
            </label>
            <button className="button" disabled={!!busy}>
              Fetch page
            </button>
          </form>
          <p className="tiny muted">
            Some sites require login, block fetching, or need JavaScript. Paste
            their job description instead.
          </p>
          <label>
            Or paste page / job description text
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={30000}
              disabled={!!busy}
            />
          </label>
          <button
            className="button secondary"
            disabled={!!busy || text.trim().length < 80}
            onClick={() => {
              setSourceUrl("");
              setTitle("Pasted job description");
              setWarnings([]);
              setStep("inspect");
            }}
          >
            Inspect pasted text
          </button>
        </>
      )}
      {step === "inspect" && (
        <>
          {title && <p>{title}</p>}
          {sourceUrl && (
            <p className="tiny muted" style={{ overflowWrap: "anywhere" }}>
              {sourceUrl}
            </p>
          )}
          <label>
            Text to send to {provider}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={30000}
              disabled={!!busy}
              style={{ minHeight: 280 }}
            />
          </label>
          <p className="tiny muted">
            {text.length.toLocaleString()} / 30,000 characters. Remove unrelated
            jobs and check for missing sections.
          </p>
          <div className="actions">
            <button
              className="button"
              disabled={!!busy || text.trim().length < 80}
              onClick={() =>
                void execute(`Extracting with ${provider}…`, async (signal) => {
                  const result = (await request(
                    "/api/jobs/extract",
                    { text },
                    signal,
                  )) as Draft;
                  setDraft(result);
                  setWarnings(result.warnings);
                  setStep("review");
                })
              }
            >
              Extract job details
            </button>
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={manual}
            >
              Enter details manually
            </button>
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => setStep("input")}
            >
              Back
            </button>
          </div>
          <CostHint ai={ai} step="job" sourceChars={text.length} />
        </>
      )}
      {step === "review" && (
        <form className="form" onSubmit={save}>
          <p className="tiny muted">
            Check the listing against its source. AI extraction can omit or
            misinterpret details.
            {draft.metadata &&
              ` Extraction used ${usageLabel(draft.metadata)}.`}
          </p>
          <label>
            Company
            <input
              required
              maxLength={160}
              value={draft.company}
              onChange={(e) => setDraft({ ...draft, company: e.target.value })}
              disabled={!!busy}
              name="company"
            />
          </label>
          <label>
            Role
            <input
              required
              maxLength={160}
              value={draft.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value })}
              disabled={!!busy}
              name="role"
            />
          </label>
          <label>
            Job description
            <textarea
              required
              minLength={20}
              maxLength={15000}
              value={draft.jd}
              onChange={(e) => setDraft({ ...draft, jd: e.target.value })}
              disabled={!!busy}
              name="jd"
              style={{ minHeight: 280 }}
            />
          </label>
          <p className="tiny muted">
            {draft.jd.length.toLocaleString()} / 15,000 characters · Saved stage
          </p>
          <div className="actions">
            <button
              className="button"
              disabled={!!busy || draft.jd.length > 15000}
            >
              Confirm and save application
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!!busy}
              onClick={() => setStep("inspect")}
            >
              Back to source
            </button>
          </div>
        </form>
      )}
      {busy && <p role="status">{busy}</p>}
      <button
        className="button secondary"
        disabled={busy === "Saving application…"}
        onClick={() => {
          controller.current?.abort();
          close();
        }}
      >
        Cancel
      </button>
    </div>
  );
}

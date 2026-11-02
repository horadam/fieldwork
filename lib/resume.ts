import { z } from "zod";
import { experienceInput, type Experience } from "./domain";
export const RESUME_PROMPT_VERSION = "resume-v3";
export const MAX_RESUME_CHARS = 20000;
const page = z.object({
  page: z.number().int().min(1).max(10),
  text: z.string().max(MAX_RESUME_CHARS),
});
export const resumeSource = z
  .object({
    text: z.string().max(MAX_RESUME_CHARS).trim().min(30),
    pages: z.array(page).max(10).default([]),
  })
  .superRefine((source, ctx) => {
    if (
      source.pages.length &&
      (source.pages
        .map((p) => p.text)
        .join("\n\n")
        .trim() !== source.text ||
        new Set(source.pages.map((p) => p.page)).size !== source.pages.length)
    )
      ctx.addIssue({
        code: "custom",
        message: "Page text must match source text.",
      });
  });
export type ResumeSource = z.infer<typeof resumeSource>;
export const draftSchema = z.object({
  kind: z.enum(["role", "project"]),
  organization: z.string().max(160),
  role: z.string().max(160),
  dates: z.string().max(160),
  accomplishments: z.array(z.string().min(1).max(1000)).max(12),
  warnings: z.array(z.string().max(300)).max(8),
});
export const extractionSchema = z.object({
  drafts: z.array(draftSchema).max(30),
  warnings: z.array(z.string().max(300)).max(10),
});
export type Draft = z.infer<typeof draftSchema>;
export const provenanceSchema = z.object({
  kind: z.enum(["role", "project"]),
  organization: z.string().max(160),
  role: z.string().max(160),
  dates: z.string().max(160),
  passages: z
    .array(
      z.object({
        quote: z.string().min(1).max(700),
        page: z.number().int().min(1).max(10).nullable(),
      }),
    )
    .max(5)
    .optional(),
  provider: z.enum(["ollama", "openai"]),
  model: z.string().min(1).max(100),
  promptVersion: z.string().max(100),
  confirmedAt: z.string().datetime(),
});
export type Provenance = z.infer<typeof provenanceSchema>;
export const importEntrySchema = experienceInput.extend({
  itemId: z.string().uuid(),
  provenance: provenanceSchema,
});
export const importSchema = z
  .object({
    batchId: z.string().uuid(),
    entries: z.array(importEntrySchema).min(1).max(30),
  })
  .superRefine((v, c) => {
    if (new Set(v.entries.map((e) => e.itemId)).size !== v.entries.length)
      c.addIssue({ code: "custom", message: "Duplicate import IDs" });
  });
export type ImportBatch = z.infer<typeof importSchema>;
const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export function draftExperience(draft: Draft) {
  return {
    title: [draft.organization, draft.role]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 160),
    body: [draft.dates, ...draft.accomplishments].filter(Boolean).join("\n"),
  };
}
export type DuplicateCandidate = {
  title: string;
  body: string;
  provenance?: Pick<Provenance, "organization" | "role" | "dates"> | null;
};
export type ReviewDraft = {
  id: string;
  draft: Draft;
  title: string;
  body: string;
  selected: boolean;
  duplicate: boolean;
};
export function likelyDuplicate(
  entry: DuplicateCandidate,
  existing: DuplicateCandidate[],
) {
  return existing.some((e) => {
    if (
      normalize(e.title) === normalize(entry.title) &&
      normalize(e.body) === normalize(entry.body)
    )
      return true;
    const a = entry.provenance,
      b = e.provenance;
    return !!(
      a &&
      b &&
      normalize(a.organization) &&
      normalize(a.organization) === normalize(b.organization) &&
      normalize(a.role) === normalize(b.role) &&
      normalize(a.dates) === normalize(b.dates)
    );
  });
}
export class ResumeOutputError extends Error {
  constructor(
    message: string,
    public code: "invalid_draft_schema",
  ) {
    super(message);
  }
}

export function validateExtraction(raw: unknown, input: ResumeSource) {
  resumeSource.parse(input);
  const parsed = extractionSchema.safeParse(raw);
  if (!parsed.success) {
    const paths = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ].slice(0, 4);
    throw new ResumeOutputError(
      `The model returned invalid draft fields (${paths.join(", ") || "root"}). Missing text fields must be empty strings. Try generating drafts again or use a shorter source.`,
      "invalid_draft_schema",
    );
  }
  const output = parsed.data;
  for (const draft of output.drafts)
    draft.warnings = [
      ...new Set([
        "Review roles, dates, accomplishments, metrics, and ownership before confirming. These are AI-generated drafts.",
        ...(!draft.dates
          ? [
              "Dates were not supplied; leave empty unless you can confirm them.",
            ]
          : []),
        ...draft.warnings,
      ]),
    ].slice(0, 8);
  return output;
}
export function importLocal(
  existing: Experience[],
  input: ImportBatch,
): Experience[] {
  const batch = importSchema.parse(input);
  const additions = batch.entries.filter(
    (e) =>
      !existing.some(
        (x) =>
          x.import_batch_id === batch.batchId && x.import_item_id === e.itemId,
      ),
  );
  if (existing.length + additions.length > 50)
    throw new Error(
      "Experience bank is limited to 50 entries. Remove entries or select fewer drafts.",
    );
  return [
    ...existing,
    ...additions.map(({ itemId, ...entry }) => ({
      ...entry,
      id: itemId,
      import_batch_id: batch.batchId,
      import_item_id: itemId,
    })),
  ];
}

export function reviewDrafts(
  drafts: Draft[],
  existing: Experience[],
): ReviewDraft[] {
  const seen: DuplicateCandidate[] = [...existing];
  return drafts.map((draft) => {
    const entry = draftExperience(draft),
      candidate = { ...entry, provenance: draft },
      duplicate = likelyDuplicate(candidate, seen);
    seen.push(candidate);
    return {
      id: crypto.randomUUID(),
      draft,
      ...entry,
      duplicate,
      selected: !duplicate,
    };
  });
}

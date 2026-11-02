import { z } from "zod";
import type { Provenance } from "./resume";

export const stageSchema = z.enum([
  "Saved",
  "Applied",
  "Interview",
  "Offer",
  "Closed",
]);
export const experienceInput = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(10).max(5000),
});
export const jobInput = z.object({
  company: z.string().trim().min(1).max(160),
  role: z.string().trim().min(1).max(160),
  jd: z.string().trim().min(20).max(15000),
  stage: stageSchema,
  notes: z.string().max(4000),
});
export const analysisSchema = z.object({
  summary: z.string().min(1).max(1500),
  requirements: z
    .array(
      z.object({
        id: z.string().min(1).max(50),
        requirement: z.string().min(1).max(700),
        status: z.enum(["supported", "partial", "unsupported"]),
        explanation: z.string().min(1).max(1200),
        evidenceIds: z.array(z.string()).max(20),
      }),
    )
    .min(1)
    .max(20),
  questions: z
    .array(
      z.object({
        text: z.string().min(1).max(700),
        requirementId: z.string().min(1).max(50),
      }),
    )
    .min(1)
    .max(12),
  tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        detail: z.string().min(1).max(1000),
        requirementId: z.string().min(1).max(50),
      }),
    )
    .min(1)
    .max(12),
});
export type Analysis = z.infer<typeof analysisSchema>;
export type Experience = z.infer<typeof experienceInput> & {
  id: string;
  provenance?: Provenance | null;
  import_batch_id?: string;
  import_item_id?: string;
};
export type Job = z.infer<typeof jobInput> & { id: string };
export type Run = {
  id: string;
  application_id: string;
  status: "pending" | "running" | "completed" | "failed";
  output: Analysis | null;
  error: string | null;
  created_at: string;
  prompt_version: string;
  provider?: "ollama" | "openai" | "simulated";
  model: string;
  duration_ms: number | null;
  input_tokens?: number;
  output_tokens?: number;
  jd_snapshot?: string;
  evidence_snapshot?: Experience[];
};
export type Task = {
  id: string;
  run_id: string;
  title: string;
  detail: string;
  done: boolean;
};
export type Workspace = {
  jobs: Job[];
  experience: Experience[];
  runs: Run[];
  tasks: Task[];
};

// Referential validation complements the schema. Semantic grounding still needs evaluation.
export function validateAnalysis(
  raw: unknown,
  evidence: Experience[],
): Analysis {
  const out = analysisSchema.parse(raw);
  const evidenceIds = new Set(evidence.map((e) => e.id));
  const requirements = new Set(out.requirements.map((r) => r.id));
  if (requirements.size !== out.requirements.length)
    throw new Error("Duplicate requirement IDs");
  for (const r of out.requirements) {
    if (r.evidenceIds.some((id) => !evidenceIds.has(id)))
      throw new Error("Unknown evidence reference");
    if (r.status !== "unsupported" && !r.evidenceIds.length)
      throw new Error("Supported or partial requirements need evidence");
    if (r.status === "unsupported" && r.evidenceIds.length)
      throw new Error(
        "Unsupported requirements cannot cite supporting evidence",
      );
  }
  if (
    [...out.questions, ...out.tasks].some(
      (item) => !requirements.has(item.requirementId),
    )
  )
    throw new Error("Unknown requirement reference");
  return out;
}

export function approveLocal(state: Workspace, run: Run): Workspace {
  if (run.status !== "completed" || !run.output)
    throw new Error("Only completed analyses can be approved");
  if (state.tasks.some((t) => t.run_id === run.id)) return state;
  return {
    ...state,
    tasks: [
      ...state.tasks,
      ...run.output.tasks.map((t, i) => ({
        id: `${run.id}-${i}`,
        run_id: run.id,
        title: t.title,
        detail: t.detail,
        done: false,
      })),
    ],
  };
}

// Deliberately conservative offline preview. This is NOT an LLM evaluation or inference engine.
export function demoAnalysis(job: Job, evidence: Experience[]): Analysis {
  const lines = job.jd
    .split(/[\n;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8)
    .slice(0, 8);
  return validateAnalysis(
    {
      summary:
        "Simulated preview: requirements are awaiting your review. No model was called and no qualifications were inferred. Add user-confirmed experience, then run real analysis after configuration.",
      requirements: lines.map((line, i) => ({
        id: `r${i + 1}`,
        requirement: line.slice(0, 700),
        status: "unsupported",
        explanation:
          "Not assessed in simulated preview. Review your evidence; live analysis can propose a match.",
        evidenceIds: [],
      })),
      questions: lines.slice(0, 4).map((line, i) => ({
        text: `Which real example best demonstrates: ${line.slice(0, 250)}?`,
        requirementId: `r${i + 1}`,
      })),
      tasks: lines.slice(0, 4).map((line, i) => ({
        title: `Prepare evidence for requirement ${i + 1}`,
        detail: `Review: ${line.slice(0, 700)}. Identify your contribution, a tradeoff, and a defensible outcome.`,
        requirementId: `r${i + 1}`,
      })),
    },
    evidence,
  );
}

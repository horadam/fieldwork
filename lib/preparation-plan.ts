import { z } from "zod";
import { callMetadataSchema, feedbackSchema } from "./feedback";
import {
  analysisSchema,
  validateAnalysis,
  experienceInput,
  type Workspace,
  type Experience,
  type Run,
} from "./domain";

const text = z.string().trim().min(1);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Use a valid calendar date.");
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dayNumber = (value: string) =>
  Date.parse(`${value}T00:00:00Z`) / 86400000;
const dayDate = (value: number) =>
  new Date(value * 86400000).toISOString().slice(0, 10);
export const settingsSchema = z
  .object({
    startDate: date,
    duration: z.enum(["week", "two_weeks", "deadline"]),
    deadline: date.nullable(),
    hoursPerWeek: z.number().min(0.5).max(40),
  })
  .refine(
    (s) =>
      s.duration !== "deadline" ||
      (!!s.deadline &&
        dayNumber(s.deadline) >= dayNumber(s.startDate) &&
        dayNumber(s.deadline) - dayNumber(s.startDate) < 365),
    "Interview date must be on/after the start, within one year.",
  );
export type PlanSettings = z.infer<typeof settingsSchema>;
export const defaultSettings = (): PlanSettings => ({
  startDate: today(),
  duration: "week",
  deadline: null,
  hoursPerWeek: 12,
});
export const targetSchema = z
  .object({
    id: z.string().uuid(),
    name: text.max(160),
    jobIds: z.array(text.max(100)).min(1).max(3),
    settings: settingsSchema,
    activeVersionId: z.string().uuid().nullable(),
  })
  .refine(
    (t) => new Set(t.jobIds).size === t.jobIds.length,
    "Select distinct jobs.",
  );
export type PreparationTarget = z.infer<typeof targetSchema>;
const reference = z.object({
  jobId: text.max(100),
  requirementId: text.max(50),
});
export const planOutputSchema = z.object({
  summary: text.max(2000),
  questions: z
    .array(
      z.object({
        id: text.max(60),
        text: text.max(700),
        outline: text.max(1800),
        refs: z.array(reference).min(1).max(60),
        evidenceRefs: z
          .array(z.object({ jobId: text.max(100), evidenceId: text.max(100) }))
          .max(30),
      }),
    )
    .min(1)
    .max(18),
  activities: z
    .array(
      z.object({
        id: text.max(60),
        title: text.max(200),
        detail: text.max(1500),
        minutes: z.number().int().min(5).max(120),
        priority: z.number().int().min(1).max(3),
        type: z.enum([
          "study",
          "coding_design",
          "story_rehearsal",
          "question_practice",
        ]),
        refs: z.array(reference).min(1).max(60),
        questionIds: z.array(text.max(60)).max(18),
      }),
    )
    .min(1)
    .max(30),
});
export type PlanOutput = z.infer<typeof planOutputSchema>;
const evidenceSchema = experienceInput.extend({ id: text.max(100) });
export const sourceSchema = z.object({
  jobId: text.max(100),
  company: text.max(160),
  role: text.max(160),
  analysisId: text.max(100),
  jdSnapshot: text.max(15000),
  evidenceSnapshot: z.array(evidenceSchema).max(50),
  analysis: analysisSchema,
  jdFingerprint: text.max(64),
  evidenceFingerprint: text.max(64),
});
export type PlanSource = z.infer<typeof sourceSchema>;
export const versionSchema = z.object({
  id: z.string().uuid(),
  targetId: z.string().uuid(),
  createdAt: z.string().datetime(),
  settings: settingsSchema,
  sources: z.array(sourceSchema).min(1).max(3),
  output: planOutputSchema,
  excludedActivityIds: z.array(text.max(60)).max(30),
  metadata: z.object({
    provider: z.enum(["ollama", "openai"]),
    model: text.max(100),
    promptVersion: text.max(100),
    durationMs: z.number().nonnegative(),
    // Optional: versions saved before usage was recorded lack them.
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    // Links removed from the model's reply before review.
    repairs: z.array(text.max(300)).max(10).optional(),
  }),
});
export type PreparationPlanVersion = z.infer<typeof versionSchema>;
export const progressSchema = z.object({
  planId: z.string().uuid(),
  answers: z.record(z.string(), z.string().max(12000)),
  scores: z.record(
    z.string(),
    z.record(z.string(), z.number().int().min(1).max(5)),
  ),
  done: z.record(z.string(), z.boolean()),
  // AI review of a question's notes, kept with the notes it reviewed so the
  // UI can say when they have changed since. Optional: older progress has none.
  reviews: z
    .record(
      z.string(),
      z.object({
        notes: z.string().max(12000),
        feedback: feedbackSchema,
        metadata: callMetadataSchema,
        reviewedAt: z.string().datetime(),
      }),
    )
    .optional(),
});
export type PreparationProgress = z.infer<typeof progressSchema>;
export type PreparationState = {
  targets: PreparationTarget[];
  plans: PreparationPlanVersion[];
  progress: PreparationProgress[];
};
export const emptyPreparation = (): PreparationState => ({
  targets: [],
  plans: [],
  progress: [],
});
export const emptyProgress = (planId: string): PreparationProgress => ({
  planId,
  answers: {},
  scores: {},
  done: {},
});
export const canonicalEvidence = (entries: Experience[]) =>
  JSON.stringify(
    entries
      .map(({ id, title, body }) => ({ id, title, body }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
export function matchingRun(jobId: string, data: Workspace): Run | undefined {
  const job = data.jobs.find((j) => j.id === jobId);
  if (!job) return;
  return [...data.runs]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .find(
      (r) =>
        r.application_id === jobId &&
        r.status === "completed" &&
        r.output &&
        r.model !== "none" &&
        r.provider !== "simulated" &&
        r.jd_snapshot === job.jd &&
        r.evidence_snapshot &&
        canonicalEvidence(r.evidence_snapshot) ===
          canonicalEvidence(data.experience),
    );
}
// Why a job has no current real analysis, in one sentence the Applications
// and Study screens share; null when matchingRun finds one.
export function analysisProblem(jobId: string, data: Workspace): string | null {
  const job = data.jobs.find((j) => j.id === jobId);
  if (!job || matchingRun(jobId, data)) return null;
  const latest = [...data.runs]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .find(
      (r) =>
        r.application_id === jobId &&
        r.status === "completed" &&
        r.output &&
        r.model !== "none" &&
        r.provider !== "simulated",
    );
  if (latest && latest.jd_snapshot && latest.jd_snapshot !== job.jd)
    return "The job description changed since this analysis. Re-run a real analysis before building a plan.";
  if (latest?.evidence_snapshot)
    return "Your experience changed since this analysis. Re-run a real analysis before building a plan.";
  return "Run a current real analysis first.";
}
export type SourceProblem = {
  jobId: string;
  // "Role at Company", shown when a group needs to say which role.
  label: string | null;
  message: string;
};
export function sourceProblems(
  target: PreparationTarget,
  data: Workspace,
): SourceProblem[] {
  return target.jobIds.flatMap((id): SourceProblem[] => {
    const job = data.jobs.find((j) => j.id === id);
    if (!job)
      return [
        {
          jobId: id,
          label: null,
          message:
            "Source application deleted. Edit the group's roles, or delete this preparation, before generating.",
        },
      ];
    const message = analysisProblem(id, data);
    return message
      ? [{ jobId: id, label: `${job.role} at ${job.company}`, message }]
      : [];
  });
}
async function fingerprint(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
// Missing, outdated or invalid analyses behind a target; callers map this to 400.
export class SourceError extends Error {}
export async function planSources(
  target: PreparationTarget,
  data: Workspace,
): Promise<PlanSource[]> {
  targetSchema.parse(target);
  const problems = sourceProblems(target, data);
  if (problems.length)
    throw new SourceError(
      problems
        .map((p) => (p.label ? `${p.label}: ${p.message}` : p.message))
        .join(" "),
    );
  return Promise.all(
    target.jobIds.map(async (id) => {
      const job = data.jobs.find((j) => j.id === id)!,
        run = matchingRun(id, data)!;
      const evidence = JSON.parse(
        canonicalEvidence(run.evidence_snapshot!),
      ) as Experience[];
      return sourceSchema.parse({
        jobId: id,
        company: job.company,
        role: job.role,
        analysisId: run.id,
        jdSnapshot: job.jd,
        evidenceSnapshot: evidence,
        analysis: (() => {
          try {
            return validateAnalysis(run.output, evidence);
          } catch {
            throw new SourceError("A stored analysis failed validation.");
          }
        })(),
        jdFingerprint: await fingerprint(job.jd),
        evidenceFingerprint: await fingerprint(canonicalEvidence(evidence)),
      });
    }),
  );
}
// The model only sees evidence its analysis cited, so plans may only reference that.
export function citedEvidence(source: PlanSource | undefined) {
  if (!source) return [];
  return source.evidenceSnapshot.filter((e) =>
    source.analysis.requirements.some((r) => r.evidenceIds.includes(e.id)),
  );
}
export function validatePlan(raw: unknown, sources: PlanSource[]): PlanOutput {
  const output = planOutputSchema.parse(raw);
  for (const source of sources)
    validateAnalysis(source.analysis, source.evidenceSnapshot);
  const jobs = new Map(sources.map((s) => [s.jobId, s]));
  if (jobs.size !== sources.length) throw new Error("Duplicate source jobs.");
  function refs(items: z.infer<typeof reference>[]) {
    for (const ref of items)
      if (
        !jobs
          .get(ref.jobId)
          ?.analysis.requirements.some((r) => r.id === ref.requirementId)
      )
        throw new Error("Unknown job requirement reference.");
  }
  const questions = new Set(output.questions.map((q) => q.id)),
    activities = new Set(output.activities.map((a) => a.id));
  if (
    questions.size !== output.questions.length ||
    activities.size !== output.activities.length
  )
    throw new Error("Duplicate preparation item IDs.");
  for (const q of output.questions) {
    refs(q.refs);
    for (const ref of q.evidenceRefs)
      if (
        !q.refs.some((r) => r.jobId === ref.jobId) ||
        !citedEvidence(jobs.get(ref.jobId)).some((e) => e.id === ref.evidenceId)
      )
        throw new Error("Unknown question evidence reference.");
  }
  for (const a of output.activities) {
    refs(a.refs);
    if (a.questionIds.some((id) => !questions.has(id)))
      throw new Error("Unknown practice question.");
    if (a.type === "question_practice" && !a.questionIds.length)
      throw new Error("Question practice must reference questions.");
  }
  return output;
}
export function validateVersion(raw: unknown) {
  const plan = versionSchema.parse(raw);
  validatePlan(plan.output, plan.sources);
  if (
    new Set(plan.excludedActivityIds).size !==
      plan.excludedActivityIds.length ||
    plan.excludedActivityIds.some(
      (id) => !plan.output.activities.some((a) => a.id === id),
    )
  )
    throw new Error("Invalid excluded activities.");
  return plan;
}
export function schedulePlan(
  output: PlanOutput,
  settings: PlanSettings,
  excluded: string[] = [],
) {
  settingsSchema.parse(settings);
  const start = dayNumber(settings.startDate),
    end =
      settings.duration === "deadline"
        ? dayNumber(settings.deadline!) + 1
        : start + (settings.duration === "week" ? 7 : 14);
  const weeks = Array.from(
    { length: Math.ceil((end - start) / 7) },
    (_, i) => ({
      start: dayDate(start + i * 7),
      end: dayDate(Math.min(end, start + (i + 1) * 7) - 1),
      capacity: Math.floor(
        (settings.hoursPerWeek * 60 * Math.min(7, end - start - i * 7)) / 7,
      ),
      used: 0,
      activityIds: [] as string[],
    }),
  );
  const deferred: string[] = [];
  for (const activity of output.activities
    .filter((a) => !excluded.includes(a.id))
    .sort((a, b) => a.priority - b.priority)) {
    const week = weeks.find((w) => w.used + activity.minutes <= w.capacity);
    if (week) {
      week.activityIds.push(activity.id);
      week.used += activity.minutes;
    } else deferred.push(activity.id);
  }
  const covered = new Set(
    output.activities
      .filter((a) => weeks.some((w) => w.activityIds.includes(a.id)))
      .flatMap((a) => a.refs.map((r) => `${r.jobId}:${r.requirementId}`)),
  );
  return {
    weeks,
    deferred,
    covered,
    capacity: weeks.reduce((n, w) => n + w.capacity, 0),
    used: weeks.reduce((n, w) => n + w.used, 0),
  };
}
export function outdated(
  plan: PreparationPlanVersion,
  target: PreparationTarget,
  data: Workspace,
) {
  return (
    JSON.stringify(plan.settings) !== JSON.stringify(target.settings) ||
    target.jobIds.length !== plan.sources.length ||
    plan.sources.some(
      (s) =>
        !target.jobIds.includes(s.jobId) ||
        data.jobs.find((j) => j.id === s.jobId)?.jd !== s.jdSnapshot ||
        data.jobs.find((j) => j.id === s.jobId)?.company !== s.company ||
        data.jobs.find((j) => j.id === s.jobId)?.role !== s.role ||
        canonicalEvidence(data.experience) !==
          canonicalEvidence(s.evidenceSnapshot),
    )
  );
}
export function activateLocal(
  state: PreparationState,
  target: PreparationTarget,
  raw: unknown,
): PreparationState {
  const plan = validateVersion(raw);
  targetSchema.parse(target);
  if (plan.targetId !== target.id) throw new Error("Target/version mismatch.");
  if (!state.targets.some((t) => t.id === target.id))
    throw new Error("Target not found.");
  const existing = state.plans.find((p) => p.id === plan.id);
  if (existing) {
    if (existing.targetId !== target.id)
      throw new Error("Version belongs to another target.");
    return state;
  }
  if (
    plan.sources.length !== target.jobIds.length ||
    plan.sources.some((s) => !target.jobIds.includes(s.jobId))
  )
    throw new Error("Target sources changed. Generate a new draft.");
  return {
    ...state,
    targets: state.targets.map((t) =>
      t.id === target.id
        ? { ...t, settings: plan.settings, activeVersionId: plan.id }
        : t,
    ),
    plans: [...state.plans, plan],
    progress: [...state.progress, emptyProgress(plan.id)],
  };
}
export function validateProgress(raw: unknown, plan: PreparationPlanVersion) {
  const p = progressSchema.parse(raw),
    questions = new Set(plan.output.questions.map((q) => q.id)),
    activities = new Set(plan.output.activities.map((a) => a.id));
  if (
    p.planId !== plan.id ||
    Object.keys(p.answers).some((id) => !questions.has(id)) ||
    Object.keys(p.scores).some((id) => !questions.has(id)) ||
    Object.keys(p.reviews || {}).some((id) => !questions.has(id)) ||
    Object.keys(p.done).some((id) => !activities.has(id)) ||
    Object.values(p.scores).some((scores) =>
      Object.keys(scores).some(
        (key) =>
          ![
            "Clarity",
            "Correctness",
            "Depth",
            "Tradeoffs",
            "Ownership",
          ].includes(key),
      ),
    )
  )
    throw new Error("Invalid preparation progress.");
  return p;
}

// What Applications and the Overview show about each preparation target:
// whether it has an active plan, and how much of its scheduled work is left.
export type PlanSummary = {
  targetId: string;
  name: string;
  jobIds: string[];
  plan: {
    createdAt: string;
    questions: number;
    scheduled: number;
    remaining: number;
  } | null;
};
export function planSummaries(state: PreparationState): PlanSummary[] {
  return state.targets.map((target) => {
    const plan = state.plans.find((p) => p.id === target.activeVersionId);
    if (!plan)
      return {
        targetId: target.id,
        name: target.name,
        jobIds: target.jobIds,
        plan: null,
      };
    const done = state.progress.find((p) => p.planId === plan.id)?.done ?? {};
    const scheduled = schedulePlan(
      plan.output,
      plan.settings,
      plan.excludedActivityIds,
    ).weeks.flatMap((w) => w.activityIds);
    return {
      targetId: target.id,
      name: target.name,
      jobIds: target.jobIds,
      plan: {
        createdAt: plan.createdAt,
        questions: plan.output.questions.length,
        scheduled: scheduled.length,
        remaining: scheduled.filter((id) => !done[id]).length,
      },
    };
  });
}

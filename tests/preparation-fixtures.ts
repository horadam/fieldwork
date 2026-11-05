import { demoAnalysis, type Workspace } from "../lib/domain";
import {
  type PlanOutput,
  type PreparationTarget,
  type PreparationPlanVersion,
} from "../lib/preparation-plan";
export const targetId = "a1111111-1111-4111-8111-111111111111";
export const planId = "b1111111-1111-4111-8111-111111111111";
export const settings = {
  startDate: "2026-10-22",
  duration: "week" as const,
  deadline: null,
  hoursPerWeek: 12,
};
export const target: PreparationTarget = {
  id: targetId,
  name: "Example engineering",
  jobIds: ["job-a"],
  settings,
  activeVersionId: null,
};
export const experience = [
  {
    id: "e1",
    title: "React delivery",
    body: "Built accessible React applications and Node APIs.",
  },
];
const job = {
  id: "job-a",
  company: "Example",
  role: "Engineer",
  jd: "Build accessible React applications and Node APIs.",
  stage: "Saved" as const,
  notes: "",
};
const analysis = demoAnalysis(job, experience);
analysis.requirements[0].status = "supported";
analysis.requirements[0].evidenceIds = ["e1"];
export function workspace(): Workspace {
  return structuredClone({
    jobs: [job],
    experience,
    runs: [
      {
        id: "run-a",
        application_id: job.id,
        status: "completed",
        output: analysis,
        error: null,
        created_at: "2026-10-22T10:00:00.000Z",
        prompt_version: "grounded-v3",
        provider: "ollama",
        model: "qwen3:8b",
        duration_ms: 1,
        jd_snapshot: job.jd,
        evidence_snapshot: structuredClone(experience),
      },
    ],
    tasks: [],
  });
}
export function output(): PlanOutput {
  return {
    summary: "Prioritize delivery stories and practical React review.",
    questions: [
      {
        id: "q1",
        text: "Describe a React feature you shipped.",
        outline: "Explain the real contribution, tradeoff and outcome.",
        refs: [{ jobId: "job-a", requirementId: "r1" }],
        evidenceRefs: [{ jobId: "job-a", evidenceId: "e1" }],
      },
    ],
    activities: [
      {
        id: "a1",
        title: "Rehearse the React delivery story",
        detail:
          "Answer the question aloud and review your contribution and tradeoff.",
        minutes: 30,
        priority: 1,
        type: "question_practice",
        refs: [{ jobId: "job-a", requirementId: "r1" }],
        questionIds: ["q1"],
      },
      {
        id: "a2",
        title: "Practice a React form",
        detail: "Build a form with validation and a failure state without AI.",
        minutes: 60,
        priority: 2,
        type: "coding_design",
        refs: [{ jobId: "job-a", requirementId: "r1" }],
        questionIds: [],
      },
    ],
  };
}
// The same plan as the model returns it: links as "jobId#id" keys.
export function modelReply(plan: PlanOutput = output()) {
  return {
    ...plan,
    questions: plan.questions.map((q) => ({
      ...q,
      refs: q.refs.map((r) => `${r.jobId}#${r.requirementId}`),
      evidenceRefs: q.evidenceRefs.map((e) => `${e.jobId}#${e.evidenceId}`),
    })),
    activities: plan.activities.map((a) => ({
      ...a,
      refs: a.refs.map((r) => `${r.jobId}#${r.requirementId}`),
    })),
  };
}
export const metadata = {
  provider: "ollama" as const,
  model: "qwen3:8b",
  promptVersion: "preparation-v1",
  durationMs: 1,
};
export function version(
  sources: PreparationPlanVersion["sources"],
): PreparationPlanVersion {
  return {
    id: planId,
    targetId,
    createdAt: "2026-10-22T11:00:00.000Z",
    settings,
    sources,
    output: output(),
    excludedActivityIds: [],
    metadata,
  };
}

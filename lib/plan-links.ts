// Links between a generated preparation plan and its sources. The model may
// only choose from keys that exist (constrained in its output schema), and
// anything that still slips through is removed and reported instead of
// discarding the whole plan. Stored plans keep the { jobId, requirementId }
// shape and are still checked strictly by validatePlan.
import { z } from "zod";
import {
  citedEvidence,
  planOutputSchema,
  validatePlan,
  type PlanOutput,
  type PlanSource,
} from "./preparation-plan";

const text = z.string().trim().min(1);
const requirementKey = (jobId: string, requirementId: string) =>
  `${jobId}#${requirementId}`;
const evidenceKey = (jobId: string, evidenceId: string) =>
  `${jobId}#${evidenceId}`;

// Every requirement and cited experience entry the plan may link to.
export function linkKeys(sources: PlanSource[]) {
  const requirements = new Map<
    string,
    { jobId: string; requirementId: string }
  >();
  const evidence = new Map<string, { jobId: string; evidenceId: string }>();
  for (const source of sources) {
    for (const r of source.analysis.requirements)
      requirements.set(requirementKey(source.jobId, r.id), {
        jobId: source.jobId,
        requirementId: r.id,
      });
    for (const e of citedEvidence(source))
      evidence.set(evidenceKey(source.jobId, e.id), {
        jobId: source.jobId,
        evidenceId: e.id,
      });
  }
  return { requirements, evidence };
}

// The model's output shape, with links as keys. `ref` and `evidence` are
// either enums of real keys (sent to the model) or plain strings (used to
// read the reply leniently, so stray keys can be repaired).
function planShape(ref: z.ZodType<string>, evidence: z.ZodType<string>) {
  return z.object({
    summary: text.max(2000),
    questions: z
      .array(
        z.object({
          id: text.max(60),
          text: text.max(700),
          outline: text.max(1800),
          refs: z.array(ref).min(1).max(60),
          evidenceRefs: z.array(evidence).max(30),
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
          refs: z.array(ref).min(1).max(60),
          questionIds: z.array(text.max(60)).max(18),
        }),
      )
      .min(1)
      .max(30),
  });
}
const enumOf = (keys: string[]) =>
  keys.length
    ? z.enum(keys as [string, ...string[]])
    : // No cited experience: nothing may be linked.
      z.string().max(0);

export function modelPlanSchema(sources: PlanSource[]) {
  const keys = linkKeys(sources);
  return planShape(
    enumOf([...keys.requirements.keys()]),
    enumOf([...keys.evidence.keys()]),
  );
}
const lenientPlan = planShape(z.string(), z.string());

// A plan that can't be used; the message is a fixed, content-free reason.
export class PlanLinkError extends Error {}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Turns the model's reply into a stored-format plan. Links to things that
 * don't exist are removed, items left without any requirement are dropped,
 * and each repair is described for the draft review.
 */
export function repairPlan(
  raw: unknown,
  sources: PlanSource[],
): { output: PlanOutput; repairs: string[] } {
  const parsed = lenientPlan.safeParse(raw);
  if (!parsed.success)
    throw new PlanLinkError("it didn't match the required fields and limits");
  const keys = linkKeys(sources);
  const count = {
    requirementLinks: 0,
    evidenceLinks: 0,
    questionLinks: 0,
    duplicates: 0,
    unlinkedQuestions: 0,
    unlinkedActivities: 0,
    emptyPractice: 0,
  };
  const mapRefs = (refs: string[]) =>
    refs.flatMap((key) => {
      const ref = keys.requirements.get(key);
      if (!ref) count.requirementLinks++;
      return ref ? [ref] : [];
    });
  const seen = new Set<string>();
  const unique = <T extends { id: string }>(items: T[]) =>
    items.filter((item) => {
      if (seen.has(item.id)) {
        count.duplicates++;
        return false;
      }
      seen.add(item.id);
      return true;
    });

  const questions = unique(parsed.data.questions).flatMap((q) => {
    const refs = mapRefs(q.refs);
    if (!refs.length) {
      count.unlinkedQuestions++;
      return [];
    }
    const jobs = new Set(refs.map((r) => r.jobId));
    const evidenceRefs = q.evidenceRefs.flatMap((key) => {
      const ref = keys.evidence.get(key);
      if (!ref || !jobs.has(ref.jobId)) {
        count.evidenceLinks++;
        return [];
      }
      return [ref];
    });
    return [{ ...q, refs, evidenceRefs }];
  });
  seen.clear();
  const questionIds = new Set(questions.map((q) => q.id));
  const activities = unique(parsed.data.activities).flatMap((a) => {
    const refs = mapRefs(a.refs);
    if (!refs.length) {
      count.unlinkedActivities++;
      return [];
    }
    const linked = a.questionIds.filter((id) => questionIds.has(id));
    count.questionLinks += a.questionIds.length - linked.length;
    if (a.type === "question_practice" && !linked.length) {
      count.emptyPractice++;
      return [];
    }
    return [{ ...a, refs, questionIds: linked }];
  });

  if (!questions.length)
    throw new PlanLinkError("no question was linked to a real requirement");
  if (!activities.length)
    throw new PlanLinkError("no activity was linked to a real requirement");

  const repairs = [
    count.requirementLinks &&
      `Removed ${plural(count.requirementLinks, "link")} to requirements that don't exist.`,
    count.evidenceLinks &&
      `Removed ${plural(count.evidenceLinks, "experience link")} the analysis didn't cite for that job.`,
    count.questionLinks &&
      `Removed ${plural(count.questionLinks, "link")} to practice questions that don't exist.`,
    count.duplicates &&
      `Dropped ${plural(count.duplicates, "item")} that reused another item's ID.`,
    count.unlinkedQuestions &&
      `Dropped ${plural(count.unlinkedQuestions, "question")} with no real requirement left.`,
    count.unlinkedActivities &&
      `Dropped ${plural(count.unlinkedActivities, "activity", "activities")} with no real requirement left.`,
    count.emptyPractice &&
      `Dropped ${plural(count.emptyPractice, "practice activity", "practice activities")} whose questions don't exist.`,
  ].filter((note): note is string => !!note);

  const output = planOutputSchema.parse({
    summary: parsed.data.summary,
    questions,
    activities,
  });
  // The repaired plan must pass the same strict check as stored plans.
  return { output: validatePlan(output, sources), repairs };
}

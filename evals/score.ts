// Deterministic scorers for the eval scripts. They run in CI against canned
// outputs (tests/eval-score.test.ts); model runs stay manual and local.
import type { JobDraft } from "../lib/job-extraction";
import type { Draft } from "../lib/resume";
import {
  schedulePlan,
  type PlanOutput,
  type PlanSettings,
  type PlanSource,
} from "../lib/preparation-plan";

export const normalize = (value: string) =>
  value.toLowerCase().replace(/\s+/g, " ").trim();
const contains = (haystack: string, needle: string) =>
  normalize(haystack).includes(normalize(needle));

export function scoreResume(
  expected: { organization: string; role: string; dates: string }[],
  forbidden: string[],
  drafts: Draft[],
) {
  const remaining = [...drafts];
  let correctFields = 0;
  for (const want of expected) {
    const i = remaining.findIndex(
      (d) =>
        normalize(d.organization) === normalize(want.organization) &&
        normalize(d.role) === normalize(want.role),
    );
    if (i < 0) continue;
    const [match] = remaining.splice(i, 1);
    correctFields +=
      2 + (normalize(match.dates) === normalize(want.dates) ? 1 : 0);
  }
  const generated = drafts
    .map((d) =>
      [d.organization, d.role, d.dates, ...d.accomplishments].join("\n"),
    )
    .join("\n");
  const inventedClaimFlags = forbidden.filter((claim) =>
    contains(generated, claim),
  );
  const totalFields = expected.length * 3;
  return {
    correctFields,
    totalFields,
    exactCountMatch: expected.length === drafts.length,
    inventedClaimFlags,
    passed:
      correctFields === totalFields &&
      expected.length === drafts.length &&
      !inventedClaimFlags.length,
  };
}

export function scoreJob(
  expected: { company: string; role: string },
  mustInclude: string[],
  forbidden: string[],
  draft: JobDraft,
) {
  const companyMatch = normalize(draft.company) === normalize(expected.company);
  const roleMatch = normalize(draft.role) === normalize(expected.role);
  const kept = mustInclude.filter((phrase) => contains(draft.jd, phrase));
  const leaked = forbidden.filter(
    (phrase) =>
      contains(draft.jd, phrase) ||
      contains(draft.company, phrase) ||
      contains(draft.role, phrase),
  );
  const coverage = mustInclude.length ? kept.length / mustInclude.length : 1;
  return {
    companyMatch,
    roleMatch,
    requirementCoverage: coverage,
    missingRequirements: mustInclude.filter((p) => !kept.includes(p)),
    leakedPhrases: leaked,
    passed: companyMatch && roleMatch && coverage === 1 && !leaked.length,
  };
}

// Plans are already reference-checked by validatePlan before they reach here;
// this measures whether the plan spends time on what the analyses flagged.
export function scorePreparation(
  output: PlanOutput,
  sources: PlanSource[],
  settings: PlanSettings,
) {
  const gaps = sources.flatMap((s) =>
    s.analysis.requirements
      .filter((r) => r.status !== "supported")
      .map((r) => `${s.jobId}:${r.id}`),
  );
  const schedule = schedulePlan(output, settings);
  const scheduledGaps = gaps.filter((g) => schedule.covered.has(g));
  const practice = output.activities.filter(
    (a) => a.type === "question_practice",
  ).length;
  const jobsCovered = new Set(
    output.activities.flatMap((a) => a.refs.map((r) => r.jobId)),
  );
  return {
    questions: output.questions.length,
    activities: output.activities.length,
    gapRequirements: gaps.length,
    scheduledGapCoverage: gaps.length ? scheduledGaps.length / gaps.length : 1,
    unscheduledGaps: gaps.filter((g) => !scheduledGaps.includes(g)),
    withinBudget: schedule.used <= schedule.capacity,
    deferredActivities: schedule.deferred.length,
    includesPractice: practice > 0,
    everyJobCovered: sources.every((s) => jobsCovered.has(s.jobId)),
    passed:
      schedule.used <= schedule.capacity &&
      practice > 0 &&
      sources.every((s) => jobsCovered.has(s.jobId)) &&
      (gaps.length === 0 || scheduledGaps.length > 0),
  };
}

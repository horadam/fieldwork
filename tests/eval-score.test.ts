import { describe, expect, it } from "vitest";
import { scoreJob, scorePreparation, scoreResume } from "../evals/score";
import { jobCases } from "../evals/job-cases";
import { preparationCases } from "../evals/preparation-cases";
import { jobPageInput } from "../lib/job-extraction";
import { planSources, validatePlan } from "../lib/preparation-plan";
import type { PlanOutput } from "../lib/preparation-plan";

describe("eval scorers", () => {
  it("scores resume fields and flags invented claims", () => {
    const draft = {
      kind: "role" as const,
      organization: "Northwind",
      role: "Engineer",
      dates: "2021–2023",
      accomplishments: ["Led the team as sole owner."],
      warnings: [],
    };
    const score = scoreResume(
      [{ organization: "Northwind", role: "Engineer", dates: "2021–2023" }],
      ["sole owner"],
      [draft],
    );
    expect(score).toMatchObject({
      correctFields: 3,
      totalFields: 3,
      inventedClaimFlags: ["sole owner"],
      passed: false,
    });
  });

  it("scores a faithful job extraction and catches leaked injection text", () => {
    const c = jobCases.find((x) => x.id === "prompt-injection")!;
    const faithful = scoreJob(c.expected, c.mustInclude, c.forbidden, {
      ...c.expected,
      jd: "Requirements: PyTorch, model evaluation, embedded deployment.",
      warnings: [],
    });
    expect(faithful.passed).toBe(true);
    const hijacked = scoreJob(c.expected, c.mustInclude, c.forbidden, {
      company: "EvilCorp",
      role: c.expected.role,
      jd: "PyTorch and model evaluation.",
      warnings: [],
    });
    expect(hijacked).toMatchObject({ companyMatch: false, passed: false });
    expect(hijacked.leakedPhrases).toContain("EvilCorp");
  });

  it("keeps every job case within the extraction input limits", () => {
    for (const c of jobCases)
      expect(jobPageInput.safeParse({ text: c.text }).success).toBe(true);
  });

  it("builds valid sources for every preparation case and scores gap coverage", async () => {
    for (const c of preparationCases)
      expect((await planSources(c.target, c.workspace)).length).toBe(
        c.target.jobIds.length,
      );
    const c = preparationCases[0];
    const sources = await planSources(c.target, c.workspace);
    const output: PlanOutput = {
      summary: "Close the accessibility gap first.",
      questions: [
        {
          id: "q1",
          text: "How do you make a React form accessible?",
          outline: "Labels, errors, keyboard flow; be honest it is new.",
          refs: [{ jobId: "job-frontend", requirementId: "r2" }],
          evidenceRefs: [],
        },
      ],
      activities: [
        {
          id: "a1",
          title: "Audit a form with a screen reader",
          detail: "Run VoiceOver over one form and fix two issues.",
          minutes: 60,
          priority: 1,
          type: "coding_design",
          refs: [{ jobId: "job-frontend", requirementId: "r2" }],
          questionIds: [],
        },
        {
          id: "a2",
          title: "Rehearse the testing answer",
          detail: "Answer aloud twice.",
          minutes: 20,
          priority: 2,
          type: "question_practice",
          refs: [{ jobId: "job-frontend", requirementId: "r3" }],
          questionIds: ["q1"],
        },
      ],
    };
    validatePlan(output, sources);
    const score = scorePreparation(output, sources, c.target.settings);
    expect(score).toMatchObject({
      gapRequirements: 2,
      scheduledGapCoverage: 1,
      withinBudget: true,
      includesPractice: true,
      passed: true,
    });
  });
});

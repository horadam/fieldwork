import { describe, it, expect } from "vitest";
import {
  demoAnalysis,
  fitCoverage,
  validateAnalysis,
  type Analysis,
} from "../lib/domain";
import { seed } from "../lib/seed";
import { cases } from "../evals/cases";
const valid = (): Analysis => ({
  summary: "Example",
  requirements: [
    {
      id: "r1",
      requirement: "React",
      status: "supported",
      explanation: "Direct evidence",
      evidenceIds: ["demo-e1"],
    },
  ],
  questions: [{ text: "Describe your work", requirementId: "r1" }],
  tasks: [
    {
      title: "Prepare story",
      detail: "Explain the implementation",
      requirementId: "r1",
    },
  ],
});
describe("grounding contract", () => {
  it("accepts valid references", () =>
    expect(validateAnalysis(valid(), seed.experience)).toEqual(valid()));
  it("rejects malformed output", () =>
    expect(() =>
      validateAnalysis({ summary: "missing" }, seed.experience),
    ).toThrow());
  it("rejects invented evidence IDs", () => {
    const a = valid();
    a.requirements[0].evidenceIds = ["invented"];
    expect(() => validateAnalysis(a, seed.experience)).toThrow(
      "Unknown evidence",
    );
  });
  it("rejects supported claims without evidence", () => {
    const a = valid();
    a.requirements[0].evidenceIds = [];
    expect(() => validateAnalysis(a, seed.experience)).toThrow("need evidence");
  });
  it("rejects evidence on unsupported claims", () => {
    const a = valid();
    a.requirements[0].status = "unsupported";
    expect(() => validateAnalysis(a, seed.experience)).toThrow("cannot cite");
  });
  it("rejects duplicate requirement IDs", () => {
    const a = valid();
    a.requirements.push(a.requirements[0]);
    expect(() => validateAnalysis(a, seed.experience)).toThrow("Duplicate");
  });
  it("rejects unrelated task/question references", () => {
    const a = valid();
    a.tasks[0].requirementId = "missing";
    expect(() => validateAnalysis(a, seed.experience)).toThrow(
      "Unknown requirement",
    );
  });
  it("does not pretend to prove semantic truth", () => {
    const a = valid();
    a.requirements[0].requirement = "Rust";
    expect(validateAnalysis(a, seed.experience)).toBeTruthy();
  });
});
describe("offline preview and evaluation dataset", () => {
  it("has 20 distinct scenarios", () => {
    expect(cases).toHaveLength(20);
    expect(new Set(cases.map((c) => c.id)).size).toBe(20);
  });
  it.each(cases)("preview stays conservative for case $id ($topic)", (c) => {
    const job = { ...seed.jobs[0], jd: c.jd };
    const out = demoAnalysis(job, c.evidence);
    expect(
      out.requirements.every(
        (r) => r.status === "unsupported" && r.evidenceIds.length === 0,
      ),
    ).toBe(true);
    expect(out.summary).toContain("No model was called");
  });
});
describe("offline preview copy", () => {
  it("does not double punctuation from JD lines", () => {
    const job = {
      ...seed.jobs[0],
      jd: "Build products end to end with TypeScript.\nShip LLM features; iterate quickly!",
    };
    const out = demoAnalysis(job, []);
    expect(out.questions[0].text).toBe(
      "Which real example best demonstrates: Build products end to end with TypeScript?",
    );
    expect(out.tasks[0].detail).toMatch(
      /^Review: Build .* TypeScript\. Identify/,
    );
    expect(out.tasks[2].detail).toMatch(/^Review: iterate quickly\. Identify/);
    for (const text of [
      ...out.questions.map((q) => q.text),
      ...out.tasks.map((t) => t.detail),
    ])
      expect(text).not.toMatch(/[.!?][.?]/);
  });
});
describe("fit coverage", () => {
  it("counts requirements by status", () => {
    const analysis: Analysis = {
      summary: "Summary.",
      requirements: [
        {
          id: "r1",
          requirement: "A",
          status: "supported",
          explanation: "x",
          evidenceIds: ["e1"],
        },
        {
          id: "r2",
          requirement: "B",
          status: "supported",
          explanation: "x",
          evidenceIds: ["e1"],
        },
        {
          id: "r3",
          requirement: "C",
          status: "partial",
          explanation: "x",
          evidenceIds: ["e1"],
        },
        {
          id: "r4",
          requirement: "D",
          status: "unsupported",
          explanation: "x",
          evidenceIds: [],
        },
      ],
      questions: [],
      tasks: [],
    };
    expect(fitCoverage(analysis)).toEqual({
      supported: 2,
      partial: 1,
      unsupported: 1,
      total: 4,
    });
  });
});

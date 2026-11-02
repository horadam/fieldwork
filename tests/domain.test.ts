import { describe, it, expect } from "vitest";
import {
  approveLocal,
  demoAnalysis,
  validateAnalysis,
  type Analysis,
  type Run,
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
describe("approval gate", () => {
  const run: Run = {
    id: "run1",
    application_id: "demo-job",
    status: "completed",
    output: valid(),
    error: null,
    created_at: "2026-10-15",
    prompt_version: "test",
    model: "none",
    duration_ms: 0,
  };
  it("creates tasks only on explicit approval", () => {
    expect(seed.tasks).toHaveLength(0);
    const next = approveLocal(seed, run);
    expect(next.tasks).toHaveLength(1);
    expect(seed.tasks).toHaveLength(0);
  });
  it("is idempotent on retry", () => {
    const next = approveLocal(seed, run);
    expect(approveLocal(next, run).tasks).toHaveLength(1);
  });
  it("rejects incomplete and failed runs", () => {
    for (const status of ["pending", "running", "failed"] as const)
      expect(() => approveLocal(seed, { ...run, status })).toThrow();
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

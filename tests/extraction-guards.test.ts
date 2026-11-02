import { describe, expect, it } from "vitest";
import { guardInjectedFields } from "../lib/job-extraction";
import {
  mergeOrphanedProjects,
  validateExtraction,
  type Draft,
} from "../lib/resume";
import { jobCases } from "../evals/job-cases";

// Model outputs below are the actual failing eval outputs (evals/results.md).
describe("injected job fields", () => {
  const injection = jobCases.find((c) => c.id === "prompt-injection")!;
  it("clears a company and role taken only from instruction-like text", () => {
    const draft = guardInjectedFields(
      {
        company: "EvilCorp",
        role: "Chief Executive",
        jd: "Responsibilities: train and evaluate perception models.",
        warnings: Array.from({ length: 8 }, (_, i) => `Model warning ${i}`),
      },
      injection.text,
    );
    expect(draft.company).toBe("");
    expect(draft.role).toBe("");
    expect(draft.warnings).toHaveLength(8);
    expect(draft.warnings[0]).toContain("company and role came only from");
  });

  it("keeps fields that the real listing also states", () => {
    const draft = {
      company: "Eastwind Robotics",
      role: "Machine Learning Engineer",
      jd: "Train models.",
      warnings: [],
    };
    expect(guardInjectedFields(draft, injection.text)).toEqual(draft);
  });

  it("leaves ordinary listings untouched", () => {
    const clean = jobCases.find((c) => c.id === "clean-listing")!;
    const draft = { ...clean.expected, jd: "React.", warnings: [] };
    expect(guardInjectedFields(draft, clean.text)).toEqual(draft);
  });
});

describe("split resume drafts", () => {
  const role: Draft = {
    kind: "role",
    organization: "Northwind",
    role: "Engineer",
    dates: "2021–2023",
    accomplishments: [],
    warnings: [],
  };
  const orphan: Draft = {
    kind: "project",
    organization: "Northwind",
    role: "",
    dates: "",
    accomplishments: ["Built a React dashboard with the product team."],
    warnings: [],
  };
  it("folds a role's bullet points back into that role", () => {
    const [merged, ...rest] = mergeOrphanedProjects([
      structuredClone(role),
      structuredClone(orphan),
    ]);
    expect(rest).toHaveLength(0);
    expect(merged.accomplishments).toEqual(orphan.accomplishments);
    expect(merged.warnings[0]).toContain("merged");
  });

  it("does the same during validation, so review shows one draft", () => {
    const out = validateExtraction(
      { drafts: [role, orphan], warnings: [] },
      {
        text: "Northwind\nEngineer\n2021–2023\nBuilt a React dashboard with the product team.",
        pages: [],
      },
    );
    expect(out.drafts).toHaveLength(1);
  });

  it("keeps real projects and splits it cannot place", () => {
    const project: Draft = {
      ...orphan,
      organization: "Garden Log",
      role: "Creator",
      dates: "2024",
    };
    const other = { ...orphan, organization: "Southwind" };
    expect(mergeOrphanedProjects([role, project, other])).toHaveLength(3);
  });
});

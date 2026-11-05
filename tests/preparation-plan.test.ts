import { describe, it, expect } from "vitest";
import {
  activateLocal,
  canonicalEvidence,
  emptyPreparation,
  emptyProgress,
  matchingRun,
  outdated,
  planSources,
  planSummaries,
  schedulePlan,
  settingsSchema,
  sourceProblems,
  targetSchema,
  validatePlan,
  validateProgress,
  validateVersion,
} from "../lib/preparation-plan";
import {
  output,
  settings,
  target,
  workspace,
  version,
  planId,
} from "./preparation-fixtures";
describe("preparation sources and freshness", () => {
  it("selects current real analyses and creates stable SHA-256 source fingerprints", async () => {
    const data = workspace();
    const a = await planSources(target, data),
      b = await planSources(target, data);
    expect(a).toEqual(b);
    expect(a[0].jdFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(a[0].analysisId).toBe("run-a");
  });
  it.each([
    "simulated",
    "failed",
    "missing JD",
    "changed JD",
    "changed experience",
  ])("rejects %s analyses", async (mode) => {
    const data = workspace();
    if (mode === "simulated") data.runs[0].provider = "simulated";
    if (mode === "failed") data.runs[0].status = "failed";
    if (mode === "missing JD") delete data.runs[0].jd_snapshot;
    if (mode === "changed JD") data.jobs[0].jd += " Extra SQL requirements";
    if (mode === "changed experience")
      data.experience[0].body += " New experience";
    expect(sourceProblems(target, data)).toHaveLength(1);
    await expect(planSources(target, data)).rejects.toThrow("real analysis");
  });
  it("keeps a valid older analysis available when the newest run failed", () => {
    const data = workspace();
    data.runs.unshift({
      ...data.runs[0],
      id: "new",
      created_at: "2026-10-23T00:00:00.000Z",
      status: "failed",
    });
    expect(matchingRun("job-a", data)?.id).toBe("run-a");
  });
  it("compares evidence independent of ordering and optional provenance", () => {
    const entries = workspace().experience;
    expect(canonicalEvidence([...entries].reverse())).toBe(
      canonicalEvidence(entries),
    );
  });
  it("requires repair of missing application membership", () => {
    const data = workspace();
    data.jobs = [];
    expect(sourceProblems(target, data)[0].message).toContain("deleted");
  });
  it("caps groups and rejects duplicate membership", () => {
    expect(
      targetSchema.safeParse({ ...target, jobIds: ["a", "b", "c", "d"] })
        .success,
    ).toBe(false);
    expect(
      targetSchema.safeParse({ ...target, jobIds: ["a", "a"] }).success,
    ).toBe(false);
  });
});
describe("calendar scheduling and budgets", () => {
  it("defaults a one-week plan to 720 available minutes", () => {
    const result = schedulePlan(output(), settings);
    expect(result.capacity).toBe(720);
    expect(result.used).toBe(90);
    expect(result.weeks[0].end).toBe("2026-10-28");
  });
  it("supports two weeks and fits work across weekly buckets", () => {
    const data = output();
    data.activities[0].minutes = 60;
    const result = schedulePlan(data, {
      ...settings,
      hoursPerWeek: 1,
      duration: "two_weeks",
    });
    expect(result.capacity).toBe(120);
    expect(result.weeks.map((w) => w.used)).toEqual([60, 60]);
  });
  it("prorates partial weeks, including the interview day", () => {
    const result = schedulePlan(output(), {
      ...settings,
      duration: "deadline",
      deadline: "2026-10-22",
      hoursPerWeek: 7,
    });
    expect(result.capacity).toBe(60);
    expect(result.used).toBe(30);
    expect(result.deferred).toEqual(["a2"]);
  });
  it("does calendar arithmetic across DST and year boundaries", () => {
    expect(
      schedulePlan(output(), { ...settings, startDate: "2026-10-30" }).weeks[0]
        .end,
    ).toBe("2026-11-05");
    expect(
      schedulePlan(output(), {
        ...settings,
        startDate: "2026-12-28",
        duration: "two_weeks",
      }).weeks[1].end,
    ).toBe("2027-01-10");
  });
  it("retains priority ordering and stable ordering for ties", () => {
    const data = output();
    data.activities[0].priority = 2;
    data.activities[1].priority = 1;
    expect(schedulePlan(data, settings).weeks[0].activityIds).toEqual([
      "a2",
      "a1",
    ]);
    data.activities[1].priority = 2;
    expect(schedulePlan(data, settings).weeks[0].activityIds).toEqual([
      "a1",
      "a2",
    ]);
  });
  it("defers oversized high-priority work while fitting smaller work", () => {
    const data = output();
    data.activities[0].minutes = 120;
    data.activities[1].minutes = 20;
    const result = schedulePlan(data, { ...settings, hoursPerWeek: 0.5 });
    expect(result.used).toBe(20);
    expect(result.deferred).toEqual(["a1"]);
  });
  it("recalculates excluded activities without altering output or exceeding capacity", () => {
    const data = output(),
      before = JSON.stringify(data);
    const result = schedulePlan(data, { ...settings, hoursPerWeek: 1 }, ["a1"]);
    expect(result.weeks[0].activityIds).toEqual(["a2"]);
    expect(JSON.stringify(data)).toBe(before);
    expect(result.weeks.every((w) => w.used <= w.capacity)).toBe(true);
  });
  it.each([
    { startDate: "2026-02-30" },
    { hoursPerWeek: 0 },
    { hoursPerWeek: 41 },
    { duration: "deadline", deadline: "2026-10-01" },
    { duration: "deadline", deadline: null },
  ])("rejects invalid settings %j", (change) =>
    expect(settingsSchema.safeParse({ ...settings, ...change }).success).toBe(
      false,
    ),
  );
});
describe("validation and version lifecycle", () => {
  it("preserves references across grouped questions and consolidated activities", async () => {
    const data = workspace();
    data.jobs.push({ ...data.jobs[0], id: "job-b", company: "Second" });
    data.runs.push({ ...data.runs[0], id: "run-b", application_id: "job-b" });
    const sources = await planSources(
      { ...target, jobIds: ["job-a", "job-b"] },
      data,
    );
    const plan = output();
    plan.questions[0].refs.push({ jobId: "job-b", requirementId: "r1" });
    plan.activities[0].refs.push({ jobId: "job-b", requirementId: "r1" });
    expect(validatePlan(plan, sources).activities[0].refs).toHaveLength(2);
  });
  it.each([
    "requirement",
    "evidence",
    "question",
    "duplicate question",
    "duplicate activity",
    "empty practice",
    "duration",
  ])("rejects invalid %s", async (mode) => {
    const sources = await planSources(target, workspace()),
      plan = output();
    if (mode === "requirement")
      plan.questions[0].refs[0].requirementId = "invented";
    if (mode === "evidence")
      plan.questions[0].evidenceRefs[0].evidenceId = "invented";
    if (mode === "question") plan.activities[0].questionIds = ["invented"];
    if (mode === "duplicate question") plan.questions.push(plan.questions[0]);
    if (mode === "duplicate activity") plan.activities.push(plan.activities[0]);
    if (mode === "empty practice") plan.activities[0].questionIds = [];
    if (mode === "duration") plan.activities[0].minutes = 121;
    expect(() => validatePlan(plan, sources)).toThrow();
  });
  it("rejects evidence the analysis did not cite, since the model never saw it", async () => {
    const ws = workspace();
    const uncited = {
      id: "e2",
      title: "Unrelated work",
      body: "Organized a team offsite.",
    };
    ws.experience.push(uncited);
    ws.runs[0].evidence_snapshot!.push(uncited);
    const sources = await planSources(target, ws),
      plan = output();
    plan.questions[0].evidenceRefs[0].evidenceId = "e2";
    expect(() => validatePlan(plan, sources)).toThrow(
      "Unknown question evidence reference.",
    );
  });
  it("activates atomically and makes confirmation retries idempotent", async () => {
    const plan = version(await planSources(target, workspace()));
    const state = { ...emptyPreparation(), targets: [target] };
    const next = activateLocal(state, target, plan);
    expect(state.plans).toHaveLength(0);
    expect(next.targets[0].activeVersionId).toBe(planId);
    expect(next.progress[0]).toEqual(emptyProgress(planId));
    expect(activateLocal(next, next.targets[0], plan)).toBe(next);
  });
  it("keeps previous answers and starts fresh progress on a new version", async () => {
    const plan = version(await planSources(target, workspace()));
    const first = activateLocal(
      { ...emptyPreparation(), targets: [target] },
      target,
      plan,
    );
    first.progress[0].answers.q1 = "An actual delivery story";
    first.progress[0].done.a1 = true;
    const next = activateLocal(first, first.targets[0], {
      ...plan,
      id: "b2222222-2222-4222-8222-222222222222",
    });
    expect(next.progress[0].answers.q1).toBe("An actual delivery story");
    expect(next.progress[1].answers).toEqual({});
    expect(next.plans).toHaveLength(2);
  });
  it("detects source, membership, timing, and company changes without mutating saved versions", async () => {
    const data = workspace(),
      plan = version(await planSources(target, data));
    expect(outdated(plan, target, data)).toBe(false);
    expect(
      outdated(
        plan,
        { ...target, settings: { ...settings, hoursPerWeek: 2 } },
        data,
      ),
    ).toBe(true);
    data.jobs[0].company = "Changed";
    expect(outdated(plan, target, data)).toBe(true);
    data.jobs = [];
    expect(outdated(plan, target, data)).toBe(true);
    expect(plan.sources[0].company).toBe("Example");
  });
  it("rejects activation with mismatched target membership or invalid exclusions", async () => {
    const plan = version(await planSources(target, workspace()));
    expect(() =>
      activateLocal(
        { ...emptyPreparation(), targets: [target] },
        { ...target, jobIds: ["different"] },
        plan,
      ),
    ).toThrow("sources changed");
    expect(() =>
      validateVersion({ ...plan, excludedActivityIds: ["unknown"] }),
    ).toThrow("excluded");
  });
  it("isolates progress by stable question/activity and plan IDs", async () => {
    const plan = version(await planSources(target, workspace()));
    expect(
      validateProgress(
        {
          ...emptyProgress(plan.id),
          answers: { q1: "Example" },
          done: { a1: true },
        },
        plan,
      ).answers.q1,
    ).toBe("Example");
    for (const change of [
      { planId: "b2222222-2222-4222-8222-222222222222" },
      { answers: { wrong: "wrong" } },
      { done: { wrong: true } },
      { scores: { q1: { Invented: 3 } } },
    ])
      expect(() =>
        validateProgress({ ...emptyProgress(plan.id), ...change }, plan),
      ).toThrow();
  });
  it("round-trips approved snapshots and progress through browser serialization", async () => {
    const plan = version(await planSources(target, workspace()));
    const state = activateLocal(
      { ...emptyPreparation(), targets: [target] },
      target,
      plan,
    );
    state.progress[0].done.a1 = true;
    const restored = JSON.parse(JSON.stringify(state));
    expect(validateVersion(restored.plans[0])).toEqual(plan);
    expect(validateProgress(restored.progress[0], plan).done.a1).toBe(true);
  });
});

describe("plan summaries", () => {
  it("report each target's active plan and the scheduled work left", async () => {
    const plan = version(await planSources(target, workspace()));
    const summaries = planSummaries({
      targets: [{ ...target, activeVersionId: plan.id }],
      plans: [plan],
      progress: [{ ...emptyProgress(plan.id), done: { a1: true } }],
    });
    expect(summaries).toEqual([
      {
        targetId: target.id,
        name: target.name,
        jobIds: ["job-a"],
        plan: {
          createdAt: plan.createdAt,
          questions: 1,
          scheduled: 2,
          remaining: 1,
        },
      },
    ]);
  });

  it("report a target without an active plan", () => {
    expect(
      planSummaries({ ...emptyPreparation(), targets: [target] })[0].plan,
    ).toBeNull();
  });
});

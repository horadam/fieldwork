import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  linkKeys,
  modelPlanSchema,
  PlanLinkError,
  repairPlan,
} from "../lib/plan-links";
import { planSources } from "../lib/preparation-plan";
import { modelReply, output, target, workspace } from "./preparation-fixtures";

const sources = () => planSources(target, workspace());

describe("link keys", () => {
  it("cover every requirement and only cited experience", async () => {
    const s = await sources();
    const keys = linkKeys(s);
    expect([...keys.requirements.keys()]).toEqual(
      s[0].analysis.requirements.map((r) => `job-a#${r.id}`),
    );
    expect([...keys.evidence.keys()]).toEqual(["job-a#e1"]);
  });

  it("limit the model's links to those keys", async () => {
    const schema = z.toJSONSchema(
      modelPlanSchema(await sources()),
    ) as unknown as {
      properties: {
        questions: {
          items: {
            properties: {
              refs: { items: { enum: string[] } };
              evidenceRefs: { items: { enum: string[] } };
            };
          };
        };
      };
    };
    const question = schema.properties.questions.items.properties;
    expect(question.refs.items.enum).toContain("job-a#r1");
    expect(question.evidenceRefs.items.enum).toEqual(["job-a#e1"]);
  });
});

describe("repairing a plan", () => {
  it("keeps a valid reply unchanged, with no repairs", async () => {
    expect(repairPlan(modelReply(), await sources())).toEqual({
      output: output(),
      repairs: [],
    });
  });

  it("removes stray links but keeps the items they were on", async () => {
    const reply = modelReply();
    reply.questions[0].refs.push("job-a#invented");
    reply.questions[0].evidenceRefs.push("job-a#e9", "job-b#e1");
    reply.activities[1].refs.push("job-b#r1");
    const { output: plan, repairs } = repairPlan(reply, await sources());
    expect(plan).toEqual(output());
    expect(repairs).toEqual([
      "Removed 2 links to requirements that don't exist.",
      "Removed 2 experience links the analysis didn't cite for that job.",
    ]);
  });

  it("drops items left with nothing real to link to", async () => {
    const reply = modelReply();
    reply.activities[0].questionIds = ["q9"];
    reply.activities.push({ ...reply.activities[1], id: "a3", refs: ["x#y"] });
    reply.activities.push({ ...reply.activities[1] });
    const { output: plan, repairs } = repairPlan(reply, await sources());
    expect(plan.activities.map((a) => a.id)).toEqual(["a2"]);
    expect(repairs).toEqual([
      "Removed 1 link to requirements that don't exist.",
      "Removed 1 link to practice questions that don't exist.",
      "Dropped 1 item that reused another item's ID.",
      "Dropped 1 activity with no real requirement left.",
      "Dropped 1 practice activity whose questions don't exist.",
    ]);
  });

  it("explains why a plan can't be used at all", async () => {
    const s = await sources();
    const unlinked = modelReply();
    unlinked.questions[0].refs = ["invented#r1"];
    expect(() => repairPlan(unlinked, s)).toThrow(
      new PlanLinkError("no question was linked to a real requirement"),
    );
    expect(() => repairPlan({ summary: "Only a summary" }, s)).toThrow(
      "it didn't match the required fields and limits",
    );
  });
});

import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { planSources } from "../lib/preparation-plan";
import { target, version, workspace } from "./preparation-fixtures";
const db = new PGlite(),
  alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222",
  job = "33333333-3333-4333-8333-333333333333";
let storedTarget: typeof target, plan: ReturnType<typeof version>;
async function asUser(id: string) {
  await db.exec(
    `reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`,
  );
}
async function mutate(action: string, payload: unknown) {
  return db.query("select mutate_preparation($1,$2)", [
    action,
    JSON.stringify(payload),
  ]);
}
beforeAll(async () => {
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;insert into auth.users values('${alice}'),('${bob}');`,
  );
  for (const migration of [
    "001_workspace",
    "002_resume_import",
    "003_resume_without_citations",
    "004_preparation_targets",
  ])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${migration}.sql`, import.meta.url),
        "utf8",
      ),
    );
  await asUser(alice);
  await db.query(
    "insert into applications(id,company,role,jd,stage) values($1,'Example','Engineer','Build React applications and APIs','Saved')",
    [job],
  );
  storedTarget = { ...target, jobIds: [job] };
  const data = workspace();
  data.jobs[0].id = job;
  data.runs[0].application_id = job;
  plan = version(await planSources(storedTarget, data));
  plan.output.questions[0].refs[0].jobId = job;
  plan.output.questions[0].evidenceRefs[0].jobId = job;
  plan.output.activities.forEach((a) => (a.refs[0].jobId = job));
}, 30000);
afterAll(() => db.close());
describe.sequential(
  "preparation RLS, transactions and immutable history",
  () => {
    it("creates owned targets and rejects direct writes", async () => {
      await mutate("target", storedTarget);
      expect(
        (await db.query("select * from preparation_targets")).rows,
      ).toHaveLength(1);
      await expect(
        db.query("update preparation_targets set payload='{}'"),
      ).rejects.toThrow();
      await expect(
        db.query(
          "insert into preparation_plans(id,user_id,target_id,payload) values(gen_random_uuid(),$1,$2,'{}')",
          [alice, target.id],
        ),
      ).rejects.toThrow();
    });
    it("rejects another user reading or mutating a target and spoofing membership", async () => {
      await asUser(bob);
      expect(
        (await db.query("select * from preparation_targets")).rows,
      ).toHaveLength(0);
      await expect(mutate("target", storedTarget)).rejects.toThrow(
        "applications",
      );
      await expect(mutate("activate", plan)).rejects.toThrow(
        "Target not found",
      );
      await expect(mutate("delete", { id: target.id })).rejects.toThrow();
      await asUser(alice);
    });
    it("activates a version and initializes progress atomically", async () => {
      await mutate("activate", plan);
      const targets = await db.query<{ payload: typeof target }>(
        "select payload from preparation_targets",
      );
      expect(targets.rows[0].payload.activeVersionId).toBe(plan.id);
      expect(
        (await db.query("select * from preparation_plans")).rows,
      ).toHaveLength(1);
      expect(
        (await db.query("select * from preparation_progress")).rows,
      ).toHaveLength(1);
    });
    it("keeps activation retries idempotent without overwriting plans or progress", async () => {
      await mutate("progress", {
        planId: plan.id,
        answers: { q1: "My actual story" },
        scores: { q1: { Clarity: 4 } },
        done: { a1: true },
      });
      await mutate("activate", {
        ...plan,
        output: { summary: "Do not overwrite" },
      });
      expect(
        (
          await db.query<{ payload: typeof plan }>(
            "select payload from preparation_plans",
          )
        ).rows[0].payload.output.summary,
      ).toBe(plan.output.summary);
      expect(
        (
          await db.query<{ payload: { answers: { q1: string } } }>(
            "select payload from preparation_progress",
          )
        ).rows[0].payload.answers.q1,
      ).toBe("My actual story");
    });
    it("retains the active pointer on target edits", async () => {
      await mutate("target", {
        ...storedTarget,
        name: "New label",
        activeVersionId: null,
      });
      expect(
        (
          await db.query<{ payload: typeof target }>(
            "select payload from preparation_targets",
          )
        ).rows[0].payload.activeVersionId,
      ).toBe(plan.id);
    });
    it("rolls back a failed activation and leaves the current version intact", async () => {
      await expect(
        mutate("activate", {
          ...plan,
          id: "b3333333-3333-4333-8333-333333333333",
          sources: [],
        }),
      ).rejects.toThrow("sources changed");
      expect(
        (await db.query("select * from preparation_plans")).rows,
      ).toHaveLength(1);
      expect(
        (await db.query("select * from preparation_progress")).rows,
      ).toHaveLength(1);
    });
    it("keeps old progress read-only and prevents an old retry reactivating it", async () => {
      const next = { ...plan, id: "b2222222-2222-4222-8222-222222222222" };
      await mutate("activate", next);
      await expect(
        mutate("progress", {
          planId: plan.id,
          answers: {},
          scores: {},
          done: {},
        }),
      ).rejects.toThrow("read-only");
      await mutate("activate", plan);
      expect(
        (
          await db.query<{ payload: typeof target }>(
            "select payload from preparation_targets",
          )
        ).rows[0].payload.activeVersionId,
      ).toBe(next.id);
    });
    it("blocks cross-user access to versions and progress", async () => {
      await asUser(bob);
      expect(
        (await db.query("select * from preparation_plans")).rows,
      ).toHaveLength(0);
      expect(
        (await db.query("select * from preparation_progress")).rows,
      ).toHaveLength(0);
      await expect(
        mutate("progress", {
          planId: plan.id,
          answers: {},
          scores: {},
          done: {},
        }),
      ).rejects.toThrow("Plan not found");
      await asUser(alice);
    });
    it("preserves snapshots after an application is deleted", async () => {
      await db.query("delete from applications where id=$1", [job]);
      expect(
        (await db.query("select * from preparation_plans")).rows,
      ).toHaveLength(2);
      expect(
        (await db.query("select * from preparation_progress")).rows,
      ).toHaveLength(2);
    });
    it("deletes target versions and progress together", async () => {
      await mutate("delete", { id: target.id });
      expect(
        (await db.query("select * from preparation_targets")).rows,
      ).toHaveLength(0);
      expect(
        (await db.query("select * from preparation_plans")).rows,
      ).toHaveLength(0);
      expect(
        (await db.query("select * from preparation_progress")).rows,
      ).toHaveLength(0);
    });
    it("rejects anonymous mutation", async () => {
      await db.exec("reset role;set role anon");
      await expect(mutate("target", storedTarget)).rejects.toThrow();
    });
  },
);

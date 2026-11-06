import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { planSources } from "../lib/preparation-plan";
import { newSession } from "../lib/practice-session";
import { target, version, workspace } from "./preparation-fixtures";
const db = new PGlite(),
  alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222",
  job = "33333333-3333-4333-8333-333333333333";
let session: ReturnType<typeof newSession>;
async function user(id: string) {
  await db.exec(
    `reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`,
  );
}
const save = (s: unknown) =>
  db.query("select save_practice_session($1)", [JSON.stringify(s)]);
beforeAll(async () => {
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;insert into auth.users values('${alice}'),('${bob}');`,
  );
  for (const file of [
    "001_workspace",
    "002_resume_import",
    "003_resume_without_citations",
    "004_preparation_targets",
    "005_inference_usage",
    "006_practice_sessions",
  ])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${file}.sql`, import.meta.url),
        "utf8",
      ),
    );
  await user(alice);
  await db.query(
    "insert into applications(id,company,role,jd,stage) values($1,'Example','Engineer','Build React applications and APIs','Saved')",
    [job],
  );
  const t = { ...target, jobIds: [job] },
    data = workspace();
  data.jobs[0].id = job;
  data.runs[0].application_id = job;
  const p = version(await planSources(t, data));
  p.output.questions.forEach((q) => {
    q.refs.forEach((r) => (r.jobId = job));
    q.evidenceRefs.forEach((r) => (r.jobId = job));
  });
  p.output.activities.forEach((a) => a.refs.forEach((r) => (r.jobId = job)));
  await db.query("select mutate_preparation('target',$1)", [JSON.stringify(t)]);
  await db.query("select mutate_preparation('activate',$1)", [
    JSON.stringify(p),
  ]);
  session = newSession(p, ["q1"], "coach");
}, 30000);
afterAll(() => db.close());
it("isolates users, preserves history, retries atomically and enforces quotas", async () => {
  await save(session);
  await save(session);
  expect((await db.query("select * from practice_sessions")).rows).toHaveLength(
    1,
  );
  await expect(
    db.query("update practice_sessions set payload='{}'"),
  ).rejects.toThrow();
  await user(bob);
  expect((await db.query("select * from practice_sessions")).rows).toHaveLength(
    0,
  );
  await expect(save(session)).rejects.toThrow("Plan not found");
  await user(alice);
  await expect(save({ ...session, revision: 3 })).rejects.toThrow(
    "Session changed",
  );
  const ended = { ...session, revision: 1, status: "completed", prompt: "" };
  await save(ended);
  await save(ended);
  await expect(save({ ...ended, revision: 2 })).rejects.toThrow(
    "Session changed",
  );
  for (let i = 0; i < 60; i++)
    await db.query("select reserve_inference('practice_turn')");
  await expect(
    db.query("select reserve_inference('practice_turn')"),
  ).rejects.toThrow("Hourly");
  await db.query("select mutate_preparation('delete',$1)", [
    JSON.stringify({ id: target.id }),
  ]);
  expect((await db.query("select * from practice_sessions")).rows).toHaveLength(
    0,
  );
});

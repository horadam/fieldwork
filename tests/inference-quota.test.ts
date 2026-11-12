import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222";
async function asUser(id: string) {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`,
  );
}
const reserve = (kind: string) =>
  db.query("select public.reserve_inference($1)", [kind]);
beforeAll(async () => {
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon; insert into auth.users values('${alice}'),('${bob}');`,
  );
  // 007 also replaces start_analysis, whose return type 001 creates.
  for (const file of ["001_workspace.sql", "002_resume_import.sql"])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/005_inference_usage.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/007_quota_retry_minutes.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}, 30000);
afterAll(async () => {
  await db.close();
});
describe.sequential("hosted inference quota (PGlite)", () => {
  it("allows ten resume extractions an hour, then refuses", async () => {
    await asUser(alice);
    for (let i = 0; i < 10; i++) await reserve("resume_extraction");
    // The oldest call was just made, so its slot opens in an hour.
    await expect(reserve("resume_extraction")).rejects.toThrow(
      "Hourly inference limit reached; retry in 60 minutes",
    );
  });
  it("counts each kind and each user separately", async () => {
    await asUser(alice);
    await reserve("job_extraction");
    await asUser(bob);
    await reserve("resume_extraction");
    // Row-level security: Bob sees only his own reservation.
    expect((await db.query("select * from inference_usage")).rows).toHaveLength(
      1,
    );
  });
  it("rejects unknown kinds and direct ledger writes", async () => {
    await asUser(alice);
    await expect(reserve("analysis")).rejects.toThrow("Unknown inference kind");
    await expect(
      db.query(
        `insert into inference_usage(user_id,kind) values('${alice}','job_extraction')`,
      ),
    ).rejects.toThrow();
    await expect(db.query("delete from inference_usage")).rejects.toThrow(
      "permission denied",
    );
  });
  it("is not callable without signing in", async () => {
    await db.exec("reset role; set role anon;");
    await expect(reserve("job_extraction")).rejects.toThrow();
  });
});

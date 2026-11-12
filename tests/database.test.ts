import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222";
let job: string, run: string;
async function asUser(id: string) {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`,
  );
}
beforeAll(async () => {
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon; insert into auth.users values('${alice}'),('${bob}');`,
  );
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/001_workspace.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/002_resume_import.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/003_resume_without_citations.sql",
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
describe.sequential(
  "real PostgreSQL policies and transactions (PGlite, not hosted Supabase)",
  () => {
    it("creates user-owned data", async () => {
      await asUser(alice);
      const created = await db.query<{ id: string }>(
        "insert into applications(company,role,jd,stage) values('Example','Engineer','Build an application with React','Saved') returning id",
      );
      job = created.rows[0].id;
      await db.exec(
        "insert into experience(title,body) values('React','Built React production interfaces')",
      );
    });
    it("blocks another user reading, updating, and deleting owned rows", async () => {
      await asUser(bob);
      expect((await db.query("select * from applications")).rows).toHaveLength(
        0,
      );
      expect((await db.query("select * from experience")).rows).toHaveLength(0);
      expect(
        (await db.query("update applications set role='Stolen' returning id"))
          .rows,
      ).toHaveLength(0);
      expect(
        (await db.query("delete from applications returning id")).rows,
      ).toHaveLength(0);
      await expect(
        db.query(
          "insert into applications(user_id,company,role,jd,stage) values($1,'Bad','Bad','An attempted cross user record','Saved')",
          [alice],
        ),
      ).rejects.toThrow();
      await expect(
        db.query("select start_analysis($1,'test','v2')", [job]),
      ).rejects.toThrow("Application not found");
    });
    it("reserves a run with immutable source snapshots and rejects duplicates", async () => {
      await asUser(alice);
      const result = await db.query<{
        id: string;
        evidence_snapshot: unknown[];
      }>("select * from start_analysis($1,$2,$3)", [
        job,
        "test-model",
        "grounded-v2",
      ]);
      run = result.rows[0].id;
      expect(result.rows[0].evidence_snapshot).toHaveLength(1);
      await expect(
        db.query("select * from start_analysis($1,$2,$3)", [job, "test", "v2"]),
      ).rejects.toThrow();
      expect(
        (await db.query("select * from preparation_tasks")).rows,
      ).toHaveLength(0);
    });
    it("rejects cross-user completion and approval", async () => {
      await asUser(bob);
      await expect(
        db.query("select finish_analysis($1,null,null,0,0,0)", [run]),
      ).rejects.toThrow();
      await expect(
        db.query("select approve_analysis($1)", [run]),
      ).rejects.toThrow();
      expect((await db.query("select * from analysis_runs")).rows).toHaveLength(
        0,
      );
    });
    it("finishes a run and approves idempotently", async () => {
      await asUser(alice);
      const payload = {
        tasks: [{ title: "Practice React", detail: "Describe one component" }],
      };
      await db.query("select finish_analysis($1,$2,null,123,100,50)", [
        run,
        JSON.stringify(payload),
      ]);
      await db.query("select approve_analysis($1)", [run]);
      await db.query("select approve_analysis($1)", [run]);
      expect(
        (await db.query("select * from preparation_tasks")).rows,
      ).toHaveLength(1);
      await expect(
        db.query(
          "insert into preparation_tasks(user_id,run_id,ordinal,title,detail) values($1,$2,2,'Bypass','Bypass')",
          [alice, run],
        ),
      ).rejects.toThrow();
      await expect(
        db.query("update preparation_tasks set title='Tamper'"),
      ).rejects.toThrow();
      await db.exec("update preparation_tasks set done=true");
      expect(
        (
          await db.query<{ done: boolean }>(
            "select done from preparation_tasks",
          )
        ).rows[0].done,
      ).toBe(true);
    });
    it("persists failure status and permits a subsequent run", async () => {
      const r = await db.query<{ id: string }>(
        "select * from start_analysis($1,$2,$3)",
        [job, "test", "v2"],
      );
      await db.query("select finish_analysis($1,null,$2,45000,0,0)", [
        r.rows[0].id,
        "Execution timed out",
      ]);
      const next = await db.query<{ id: string }>(
        "select * from start_analysis($1,$2,$3)",
        [job, "test", "v2"],
      );
      await db.query("select finish_analysis($1,null,$2,1,0,0)", [
        next.rows[0].id,
        "Provider failure",
      ]);
    });
    it("enforces the hourly quota", async () => {
      for (let i = 0; i < 7; i++) {
        const r = await db.query<{ id: string }>(
          "select * from start_analysis($1,$2,$3)",
          [job, "test", "v2"],
        );
        await db.query("select finish_analysis($1,null,$2,1,0,0)", [
          r.rows[0].id,
          "Test failure",
        ]);
      }
      await expect(
        db.query("select * from start_analysis($1,$2,$3)", [job, "test", "v2"]),
      ).rejects.toThrow(/Hourly analysis limit reached; retry in \d+ minutes/);
    });
    it("deleting the job cascades its runs and tasks", async () => {
      await db.query("delete from applications where id=$1", [job]);
      expect((await db.query("select * from analysis_runs")).rows).toHaveLength(
        0,
      );
      expect(
        (await db.query("select * from preparation_tasks")).rows,
      ).toHaveLength(0);
    });
    it("deleting a job cannot bypass the hourly quota", async () => {
      const created = await db.query<{ id: string }>(
        "insert into applications(company,role,jd,stage) values('New','Engineer','Build a React application end to end','Saved') returning id",
      );
      await expect(
        db.query("select * from start_analysis($1,$2,$3)", [
          created.rows[0].id,
          "test",
          "v2",
        ]),
      ).rejects.toThrow("Hourly");
      await expect(db.query("delete from analysis_usage")).rejects.toThrow();
    });
  },
);

describe.sequential("transactional resume import", () => {
  const batch = "33333333-3333-4333-8333-333333333333",
    item = "44444444-4444-4444-8444-444444444444";
  const entry = {
    itemId: item,
    title: "Acme · Engineer",
    body: "Helped build React interfaces",
    provenance: {
      kind: "role",
      organization: "Acme",
      role: "Engineer",
      dates: "2020",
      provider: "ollama",
      model: "qwen3:8b",
      promptVersion: "resume-v1",
      confirmedAt: "2026-10-21T00:00:00Z",
      passages: [{ quote: "Helped build React interfaces", page: null }],
    },
  };
  it("saves provenance once across confirmation retries", async () => {
    await asUser(bob);
    await db.query("select * from import_resume_experience($1,$2)", [
      batch,
      JSON.stringify([entry]),
    ]);
    await db.query("select * from import_resume_experience($1,$2)", [
      batch,
      JSON.stringify([entry]),
    ]);
    const rows = (
      await db.query<{ provenance: unknown }>("select * from experience")
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].provenance).toEqual(entry.provenance);
  });
  it("does not overwrite an imported item on retry", async () => {
    await db.query("select * from import_resume_experience($1,$2)", [
      batch,
      JSON.stringify([{ ...entry, body: "Changed after first import" }]),
    ]);
    expect(
      (await db.query<{ body: string }>("select body from experience")).rows[0]
        .body,
    ).toBe(entry.body);
  });
  it("rolls back the entire batch on invalid entries", async () => {
    await expect(
      db.query("select * from import_resume_experience($1,$2)", [
        batch,
        JSON.stringify([
          { ...entry, itemId: alice },
          { ...entry, itemId: batch, body: "bad" },
        ]),
      ]),
    ).rejects.toThrow();
    expect((await db.query("select * from experience")).rows).toHaveLength(1);
  });
  it("cannot access another user’s import, even with the same batch and item IDs", async () => {
    await asUser(alice);
    expect(
      (
        await db.query("select * from experience where import_batch_id=$1", [
          batch,
        ])
      ).rows,
    ).toHaveLength(0);
    await db.query("select * from import_resume_experience($1,$2)", [
      batch,
      JSON.stringify([entry]),
    ]);
    expect(
      (
        await db.query("select * from experience where import_batch_id=$1", [
          batch,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it("enforces capacity and remains idempotent at 50 entries", async () => {
    await asUser(bob);
    await db.exec(
      "insert into experience(title,body) select 'Manual', 'Confirmed manual details' from generate_series(1,48)",
    );
    await expect(
      db.query("select * from import_resume_experience($1,$2)", [
        batch,
        JSON.stringify([
          { ...entry, itemId: alice },
          { ...entry, itemId: batch },
        ]),
      ]),
    ).rejects.toThrow("50");
    expect((await db.query("select * from experience")).rows).toHaveLength(49);
    await db.exec(
      "insert into experience(title,body) values('Last entry','Confirmed manual details')",
    );
    await db.query("select * from import_resume_experience($1,$2)", [
      batch,
      JSON.stringify([entry]),
    ]);
    await expect(
      db.query("select * from import_resume_experience($1,$2)", [
        batch,
        JSON.stringify([{ ...entry, itemId: alice }]),
      ]),
    ).rejects.toThrow("50");
    expect((await db.query("select * from experience")).rows).toHaveLength(50);
  });
  it("rejects anonymous import", async () => {
    await db.exec("reset role; set role anon");
    await expect(
      db.query("select * from import_resume_experience($1,$2)", [
        batch,
        JSON.stringify([entry]),
      ]),
    ).rejects.toThrow();
  });
});

it("preserves a two-minute local run, expires at five minutes, and records provider", async () => {
  await asUser(bob);
  const created = await db.query<{ id: string }>(
    "insert into applications(company,role,jd,stage) values('Local','Engineer','Build React interfaces for a local project','Saved') returning id",
  );
  const id = created.rows[0].id;
  const first = await db.query<{ id: string; provider: string }>(
    "select * from start_analysis($1,'qwen3:8b','grounded-v2','ollama')",
    [id],
  );
  expect(first.rows[0].provider).toBe("ollama");
  await db.exec("reset role");
  await db.query(
    "update analysis_runs set created_at=now()-interval '2 minutes' where id=$1",
    [first.rows[0].id],
  );
  await asUser(bob);
  await expect(
    db.query("select * from start_analysis($1,'qwen3:8b','v2','ollama')", [id]),
  ).rejects.toThrow();
  await db.exec("reset role");
  await db.query(
    "update analysis_runs set created_at=now()-interval '6 minutes' where id=$1",
    [first.rows[0].id],
  );
  await asUser(bob);
  await db.query("select * from start_analysis($1,'qwen3:8b','v2','ollama')", [
    id,
  ]);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from analysis_runs where id=$1",
        [first.rows[0].id],
      )
    ).rows[0].status,
  ).toBe("failed");
});

it("imports citation-free provenance transactionally after migration 003", async () => {
  await asUser(alice);
  const batch = "55555555-5555-4555-8555-555555555555";
  const entry = {
    itemId: "66666666-6666-4666-8666-666666666666",
    title: "New role",
    body: "Built a React interface with a product team",
    provenance: {
      kind: "role",
      organization: "Example",
      role: "Engineer",
      dates: "2026",
      provider: "ollama",
      model: "qwen3:8b",
      promptVersion: "resume-v3",
      confirmedAt: "2026-10-21T00:00:00Z",
    },
  };
  const rows = (
    await db.query<{ provenance: unknown }>(
      "select * from import_resume_experience($1,$2)",
      [batch, JSON.stringify([entry])],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].provenance).toEqual(entry.provenance);
});

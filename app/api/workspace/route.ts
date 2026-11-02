import { NextRequest, NextResponse } from "next/server";
import { authenticated, body, failure, HttpError } from "@/lib/server";
import { experienceInput, jobInput } from "@/lib/domain";
import { z } from "zod";
export async function GET(req: NextRequest) {
  try {
    const { db } = await authenticated(req);
    const results = await Promise.all([
      db
        .from("applications")
        .select("*")
        .order("created_at", { ascending: false }),
      db.from("experience").select("*").order("created_at"),
      db
        .from("analysis_runs")
        .select("*")
        .order("created_at", { ascending: false }),
      db.from("preparation_tasks").select("*").order("ordinal"),
    ]);
    if (results.some((r) => r.error)) throw new Error("Database read failed");
    return NextResponse.json(
      {
        jobs: results[0].data,
        experience: results[1].data,
        runs: results[2].data,
        tasks: results[3].data,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const { db, user } = await authenticated(req);
    const data = z
      .object({
        entity: z.enum(["job", "experience", "task"]),
        action: z.enum(["save", "delete"]),
        id: z.string().uuid().optional(),
        createId: z.string().uuid().optional(),
        value: z.unknown().optional(),
      })
      .parse(await body(req));
    if (
      data.createId &&
      (data.entity !== "job" || data.action !== "save" || data.id)
    )
      throw new HttpError(
        400,
        "Creation ID is only valid for a new application.",
      );
    if (data.entity === "task") {
      if (!data.id || data.action !== "save")
        throw new HttpError(400, "Task ID required.");
      const value = z.object({ done: z.boolean() }).parse(data.value);
      const r = await db
        .from("preparation_tasks")
        .update(value)
        .eq("id", data.id)
        .eq("user_id", user.id)
        .select("id");
      if (r.error) throw r.error;
      if (!r.data.length) throw new HttpError(404, "Task not found.");
    } else {
      const table = data.entity === "job" ? "applications" : "experience";
      if (data.action === "delete") {
        if (!data.id) throw new HttpError(400, "Record ID required.");
        const r = await db
          .from(table)
          .delete()
          .eq("id", data.id)
          .eq("user_id", user.id)
          .select("id");
        if (r.error) throw r.error;
        if (!r.data.length) throw new HttpError(404, "Record not found.");
      } else {
        const value =
          data.entity === "job"
            ? jobInput.parse(data.value)
            : experienceInput.parse(data.value);
        const r = data.id
          ? await db
              .from(table)
              .update(value)
              .eq("id", data.id)
              .eq("user_id", user.id)
              .select("id")
          : await db
              .from(table)
              .insert({
                ...value,
                user_id: user.id,
                ...(data.createId ? { id: data.createId } : {}),
              })
              .select("id");
        if (r.error?.code === "23505" && data.createId) {
          const existing = await db
            .from(table)
            .select("id")
            .eq("id", data.createId)
            .eq("user_id", user.id)
            .maybeSingle();
          if (existing.error || !existing.data)
            throw new HttpError(
              409,
              "Application could not be saved. Start a new import.",
            );
          return NextResponse.json({ ok: true });
        }
        if (r.error) throw r.error;
        if (!r.data.length) throw new HttpError(404, "Record not found.");
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

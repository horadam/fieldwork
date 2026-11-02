import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticated, body, failure, HttpError } from "@/lib/server";
import {
  loadPreparation,
  loadSources,
  ownedTarget,
} from "@/lib/preparation-server";
import {
  targetSchema,
  validateVersion,
  validateProgress,
  planSources,
} from "@/lib/preparation-plan";
export async function GET(req: NextRequest) {
  try {
    const { db } = await authenticated(req);
    return NextResponse.json(await loadPreparation(db), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: NextRequest) {
  try {
    const { db } = await authenticated(req);
    const input = z
      .object({
        action: z.enum(["target", "delete", "activate", "progress"]),
        value: z.unknown(),
      })
      .parse(await body(req, 1200000));
    let payload: unknown = input.value;
    if (input.action === "target") {
      const target = targetSchema.parse(input.value);
      // Application deletion leaves historical membership intact; edits may only
      // select owned, existing applications.
      const jobs = await db
        .from("applications")
        .select("id")
        .in("id", target.jobIds);
      if (jobs.error || jobs.data?.length !== target.jobIds.length)
        throw new HttpError(400, "Select existing applications you own.");
      payload = { ...target, activeVersionId: null }; // RPC retains an existing active pointer.
    } else if (input.action === "delete")
      payload = z.object({ id: z.string().uuid() }).parse(input.value);
    else if (input.action === "activate") {
      const plan = validateVersion(input.value),
        target = await ownedTarget(db, plan.targetId);
      const existing = await db
        .from("preparation_plans")
        .select("id")
        .eq("id", plan.id)
        .eq("target_id", target.id)
        .maybeSingle();
      if (existing.error)
        throw new HttpError(500, "Could not check activation retry.");
      if (!existing.data) {
        const sources = await planSources(
          target,
          await loadSources(db, target),
        );
        if (JSON.stringify(sources) !== JSON.stringify(plan.sources))
          throw new HttpError(
            409,
            "Sources changed during review. Generate a new version.",
          );
      }
      payload = plan;
    } else {
      const { planId } = z
        .object({ planId: z.string().uuid() })
        .parse(input.value);
      const record = await db
        .from("preparation_plans")
        .select("payload,target_id")
        .eq("id", planId)
        .single();
      if (record.error || !record.data)
        throw new HttpError(404, "Plan not found.");
      const target = await ownedTarget(db, record.data.target_id);
      if (target.activeVersionId !== planId)
        throw new HttpError(409, "Previous versions are read-only.");
      payload = validateProgress(
        input.value,
        validateVersion(record.data.payload),
      );
    }
    const result = await db.rpc("mutate_preparation", {
      p_action: input.action,
      p_payload: payload,
    });
    if (result.error)
      throw new HttpError(
        409,
        "Preparation save failed. Refresh and retry; review drafts are retained.",
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

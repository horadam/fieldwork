import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticated, body, failure, HttpError } from "@/lib/server";
import { validateSession } from "@/lib/practice-session";
import { ownedPracticePlan } from "@/lib/practice-server";
export async function GET(req: NextRequest) {
  try {
    const { db } = await authenticated(req);
    const id = z.string().uuid().parse(req.nextUrl.searchParams.get("planId"));
    await ownedPracticePlan(db, id, false);
    const result = await db
      .from("practice_sessions")
      .select("payload")
      .eq("plan_id", id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (result.error)
      throw new HttpError(
        503,
        "Practice storage unavailable. Apply migration 006_practice_sessions.sql.",
      );
    return NextResponse.json(
      result.data.map((r) => r.payload),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: NextRequest) {
  try {
    const { db } = await authenticated(req);
    const input = z
      .object({ planId: z.string().uuid(), session: z.unknown() })
      .parse(await body(req, 100000));
    const plan = await ownedPracticePlan(db, input.planId);
    const session = validateSession(input.session, plan);
    const result = await db.rpc("save_practice_session", {
      p_payload: session,
    });
    if (result.error)
      throw new HttpError(
        409,
        "Practice save failed. Your attempt is retained; retry saving or reload if another tab changed it. Check migration 006 is applied.",
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

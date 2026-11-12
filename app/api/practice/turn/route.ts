import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  body,
  failure,
  HttpError,
  inferenceAccess,
  reserveInference,
} from "@/lib/server";
import { requestProvider } from "@/lib/ai-provider";
import { validateVersion } from "@/lib/preparation-plan";
import { validateSession } from "@/lib/practice-session";
import { practiceTurn } from "@/lib/practice-generation";
import { ownedPracticePlan } from "@/lib/practice-server";
export const runtime = "nodejs";
export const maxDuration = 200;
export async function POST(req: NextRequest) {
  try {
    const access = await inferenceAccess(req);
    const input = z
      .object({
        planId: z.string().uuid(),
        sessionId: z.string().uuid(),
        revision: z.number().int().min(0),
        answer: z.string().trim().min(1).max(6000),
        plan: z.unknown().optional(),
        session: z.unknown().optional(),
      })
      .parse(await body(req, 1200000));
    const plan = access
      ? await ownedPracticePlan(access.db, input.planId)
      : validateVersion(input.plan);
    let raw = input.session;
    if (access) {
      const record = await access.db
        .from("practice_sessions")
        .select("payload")
        .eq("id", input.sessionId)
        .eq("plan_id", input.planId)
        .single();
      if (record.error || !record.data)
        throw new HttpError(
          404,
          "Practice session not found. Apply migration 006 and save the session first.",
        );
      raw = record.data.payload;
    }
    const session = validateSession(raw, plan);
    if (
      plan.id !== input.planId ||
      session.id !== input.sessionId ||
      session.revision !== input.revision
    )
      throw new HttpError(409, "Session changed. Reload before continuing.");
    const config = requestProvider(req.headers);
    await reserveInference(access, "practice_turn", config);
    return NextResponse.json(
      await practiceTurn(plan, session, input.answer, config, req.signal),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

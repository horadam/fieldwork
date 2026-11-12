import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { body, failure, inferenceAccess, reserveInference } from "@/lib/server";
import { requestProvider } from "@/lib/ai-provider";
import { validateVersion } from "@/lib/preparation-plan";
import { ownedPracticePlan } from "@/lib/practice-server";
import { MAX_NOTES_CHARS, reviewNotes } from "@/lib/notes-review";
export const runtime = "nodejs";
export const maxDuration = 200;
export async function POST(req: NextRequest) {
  try {
    const access = await inferenceAccess(req);
    const input = z
      .object({
        planId: z.string().uuid(),
        questionId: z.string().min(1).max(60),
        notes: z.string().trim().min(1).max(MAX_NOTES_CHARS),
        plan: z.unknown().optional(),
      })
      .parse(await body(req, 1200000));
    // Signed-in users review their own stored plan; local mode sends it.
    const plan = access
      ? await ownedPracticePlan(access.db, input.planId, false)
      : validateVersion(input.plan);
    if (plan.id !== input.planId)
      return NextResponse.json({ error: "Plan mismatch." }, { status: 409 });
    const config = requestProvider(req.headers);
    // Shares the practice quota: a notes review is one practice call.
    await reserveInference(access, "practice_turn", config);
    return NextResponse.json(
      await reviewNotes(
        plan,
        input.questionId,
        input.notes,
        config,
        req.signal,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

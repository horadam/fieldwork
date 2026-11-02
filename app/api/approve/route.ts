import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticated, body, failure, HttpError } from "@/lib/server";
import { validateAnalysis } from "@/lib/domain";
export async function POST(req: NextRequest) {
  try {
    const { db } = await authenticated(req);
    const { runId } = z
      .object({ runId: z.string().uuid() })
      .parse(await body(req));
    const record = await db
      .from("analysis_runs")
      .select("*")
      .eq("id", runId)
      .single();
    if (record.error || record.data.status !== "completed")
      throw new HttpError(404, "Completed analysis not found.");
    validateAnalysis(record.data.output, record.data.evidence_snapshot);
    const approved = await db.rpc("approve_analysis", { p_run_id: runId });
    if (approved.error) throw approved.error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

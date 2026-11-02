import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticated, body, failure, HttpError } from "@/lib/server";
import { analyze, PROMPT_VERSION } from "@/lib/agent";
import { providerConfig, providerError } from "@/lib/ai-provider";
import type { Experience } from "@/lib/domain";
export const runtime = "nodejs";
export const maxDuration = 200;
export async function POST(req: NextRequest) {
  try {
    const { db } = await authenticated(req);
    const config = providerConfig();
    const { applicationId } = z
      .object({ applicationId: z.string().uuid() })
      .parse(await body(req));
    const reservation = await db.rpc("start_analysis", {
      p_application_id: applicationId,
      p_model: config.model,
      p_prompt_version: PROMPT_VERSION,
      p_provider: config.provider,
    });
    if (reservation.error) {
      if (reservation.error.code === "23505")
        throw new HttpError(
          409,
          "An analysis is already running. Wait up to five minutes before retrying.",
        );
      if (reservation.error.message.includes("Hourly"))
        throw new HttpError(429, "Hourly analysis limit reached. Try later.");
      throw new HttpError(
        400,
        "Could not start analysis. Check the selected job, experience count, and database setup.",
      );
    }
    const record = reservation.data;
    const started = Date.now();
    try {
      const result = await analyze(
        record.jd_snapshot,
        record.evidence_snapshot as Experience[],
        config.model,
        "grounded",
        config,
        req.signal,
      );
      const saved = await db.rpc("finish_analysis", {
        p_run_id: record.id,
        p_output: result.output,
        p_error: null,
        p_duration: result.durationMs,
        p_input: result.inputTokens,
        p_output_tokens: result.outputTokens,
      });
      if (saved.error) throw saved.error;
      return NextResponse.json({ ok: true, runId: record.id });
    } catch (error) {
      const diagnostic = providerError(config, error);
      const message = diagnostic.message;
      const saved = await db.rpc("finish_analysis", {
        p_run_id: record.id,
        p_output: null,
        p_error: message,
        p_duration: Date.now() - started,
        p_input: 0,
        p_output_tokens: 0,
      });
      if (saved.error)
        throw new HttpError(
          500,
          "Could not save run status. A stale run expires on your next attempt after five minutes.",
        );
      throw diagnostic;
    }
  } catch (e) {
    return failure(e);
  }
}

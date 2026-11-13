import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticated,
  body,
  failure,
  HttpError,
  retryLater,
} from "@/lib/server";
import { analyze, ANALYSIS_PROMPT_VERSION } from "@/lib/agent";
import { AIError, providerError, requestProvider } from "@/lib/ai-provider";
import type { Experience } from "@/lib/domain";
export const runtime = "nodejs";
export const maxDuration = 200;
export async function POST(req: NextRequest) {
  try {
    const { db } = await authenticated(req);
    const config = requestProvider(req.headers);
    const { applicationId } = z
      .object({ applicationId: z.string().uuid() })
      .parse(await body(req));
    const reservation = await db.rpc("start_analysis", {
      p_application_id: applicationId,
      p_model: config.model,
      p_prompt_version: ANALYSIS_PROMPT_VERSION,
      p_provider: config.provider,
    });
    if (reservation.error) {
      if (reservation.error.code === "23505")
        throw new HttpError(
          409,
          "An analysis is already running. Wait up to five minutes before retrying.",
        );
      if (reservation.error.message.includes("Hourly"))
        throw new HttpError(
          429,
          `Hourly analysis limit reached. ${retryLater(reservation.error.message)}`,
        );
      throw new HttpError(
        400,
        "Could not start analysis. Check the selected job, experience count, and database setup.",
      );
    }
    const record = reservation.data;
    const started = Date.now();
    let result;
    try {
      result = await analyze(
        record.jd_snapshot,
        record.evidence_snapshot as Experience[],
        config,
        { signal: req.signal },
      );
    } catch (error) {
      const diagnostic = providerError(config, error);
      // Usage is known when the model answered but the output was rejected.
      const usage = error instanceof AIError ? error.usage : undefined;
      const saved = await db.rpc("finish_analysis", {
        p_run_id: record.id,
        p_output: null,
        p_error: diagnostic.message,
        p_duration: usage?.durationMs ?? Date.now() - started,
        p_input: usage?.inputTokens ?? 0,
        p_output_tokens: usage?.outputTokens ?? 0,
      });
      if (saved.error)
        throw new HttpError(
          500,
          "Could not save analysis status. A stale analysis expires on your next attempt after five minutes.",
        );
      throw diagnostic;
    }
    // A storage failure here is not an inference failure; report it as such.
    const saved = await db.rpc("finish_analysis", {
      p_run_id: record.id,
      p_output: result.output,
      p_error: null,
      p_duration: result.metadata.durationMs,
      p_input: result.metadata.inputTokens,
      p_output_tokens: result.metadata.outputTokens,
    });
    if (saved.error)
      throw new HttpError(
        500,
        "The analysis finished but could not be saved. Retry after five minutes, when the stale analysis expires.",
      );
    return NextResponse.json({
      ok: true,
      analysisRunId: record.id,
      usage: {
        provider: config.provider,
        model: config.model,
        durationMs: result.metadata.durationMs,
        inputTokens: result.metadata.inputTokens,
        outputTokens: result.metadata.outputTokens,
      },
    });
  } catch (e) {
    return failure(e);
  }
}

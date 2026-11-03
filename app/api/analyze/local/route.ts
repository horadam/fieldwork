import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { inferenceAccess, body, failure } from "@/lib/server";
import { experienceInput, MAX_JD_CHARS } from "@/lib/domain";
import { analyze } from "@/lib/agent";
import { AIError, requestProvider } from "@/lib/ai-provider";
export const runtime = "nodejs";
export const maxDuration = 200;
export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    await inferenceAccess(req, true);
    const { jd, experience } = z
      .object({
        jd: z.string().min(20).max(MAX_JD_CHARS),
        experience: z
          .array(experienceInput.extend({ id: z.string().min(1).max(100) }))
          .max(50),
      })
      .parse(await body(req, 400000));
    const config = requestProvider(req.headers);
    const { output, metadata } = await analyze(jd, experience, config, {
      signal: req.signal,
    });
    return NextResponse.json(
      { output, ...metadata },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const response = failure(error);
    return NextResponse.json(
      {
        ...(await response.json()),
        ...(error instanceof AIError && error.usage
          ? error.usage
          : { durationMs: Date.now() - started }),
      },
      { status: response.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

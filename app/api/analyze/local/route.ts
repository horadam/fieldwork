import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { inferenceAccess, body, failure } from "@/lib/server";
import { experienceInput } from "@/lib/domain";
import { analyze, PROMPT_VERSION } from "@/lib/agent";
import { providerConfig } from "@/lib/ai-provider";
export const runtime = "nodejs";
export const maxDuration = 200;
export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    await inferenceAccess(req, true);
    const { jd, experience } = z
      .object({
        jd: z.string().min(20).max(15000),
        experience: z
          .array(experienceInput.extend({ id: z.string().min(1).max(100) }))
          .max(50),
      })
      .parse(await body(req, 400000));
    const config = providerConfig();
    const result = await analyze(
      jd,
      experience,
      config.model,
      "grounded",
      config,
      req.signal,
    );
    return NextResponse.json(
      {
        ...result,
        provider: config.provider,
        model: config.model,
        promptVersion: PROMPT_VERSION,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const response = failure(error);
    return NextResponse.json(
      { ...(await response.json()), durationMs: Date.now() - started },
      { status: response.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

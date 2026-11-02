import { NextRequest, NextResponse } from "next/server";
import { inferenceAccess, body, failure, reserveInference } from "@/lib/server";
import { providerConfig } from "@/lib/ai-provider";
import { resumeSource } from "@/lib/resume";
import { extractResume } from "@/lib/resume-extraction";
export const runtime = "nodejs";
export const maxDuration = 200;
export async function POST(req: NextRequest) {
  try {
    const access = await inferenceAccess(req);
    const source = resumeSource.parse(await body(req, 65000));
    await reserveInference(access, "resume_extraction");
    const { output, metadata } = await extractResume(
      source,
      providerConfig(),
      req.signal,
    );
    return NextResponse.json(
      { ...output, metadata },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

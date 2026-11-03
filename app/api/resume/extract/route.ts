import { NextRequest, NextResponse } from "next/server";
import { inferenceAccess, body, failure, reserveInference } from "@/lib/server";
import { requestProvider } from "@/lib/ai-provider";
import { resumeSource } from "@/lib/resume";
import { extractResume } from "@/lib/resume-extraction";
export const runtime = "nodejs";
export const maxDuration = 200;
export async function POST(req: NextRequest) {
  try {
    const access = await inferenceAccess(req);
    const source = resumeSource.parse(await body(req, 65000));
    const config = requestProvider(req.headers);
    await reserveInference(access, "resume_extraction", config);
    const { output, metadata } = await extractResume(
      source,
      config,
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

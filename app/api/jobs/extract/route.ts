import { NextRequest, NextResponse } from "next/server";
import { body, failure, inferenceAccess, reserveInference } from "@/lib/server";
import { jobPageInput, extractJob } from "@/lib/job-extraction";
import { providerConfig } from "@/lib/ai-provider";
export const runtime = "nodejs";
export const maxDuration = 200;
export async function POST(req: NextRequest) {
  try {
    const access = await inferenceAccess(req);
    const { text } = jobPageInput.parse(await body(req, 100000));
    await reserveInference(access, "job_extraction");
    const { output, metadata } = await extractJob(
      text,
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

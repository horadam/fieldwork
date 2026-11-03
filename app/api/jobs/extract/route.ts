import { NextRequest, NextResponse } from "next/server";
import { body, failure, inferenceAccess, reserveInference } from "@/lib/server";
import { jobPageInput, extractJob } from "@/lib/job-extraction";
import { requestProvider } from "@/lib/ai-provider";
export const runtime = "nodejs";
export const maxDuration = 200;
export async function POST(req: NextRequest) {
  try {
    const access = await inferenceAccess(req);
    const { text } = jobPageInput.parse(await body(req, 100000));
    const config = requestProvider(req.headers);
    await reserveInference(access, "job_extraction", config);
    const { output, metadata } = await extractJob(text, config, req.signal);
    return NextResponse.json(
      { ...output, metadata },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

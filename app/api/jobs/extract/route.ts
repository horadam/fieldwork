import { NextRequest, NextResponse } from "next/server";
import { body, failure, inferenceAccess } from "@/lib/server";
import { jobPageInput, extractJob } from "@/lib/job-extraction";
import { providerConfig } from "@/lib/ai-provider";
export const runtime = "nodejs";
export const maxDuration = 200;
export async function POST(req: NextRequest) {
  try {
    await inferenceAccess(req);
    const { text } = jobPageInput.parse(await body(req, 100000));
    return NextResponse.json(
      await extractJob(text, providerConfig(), req.signal),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

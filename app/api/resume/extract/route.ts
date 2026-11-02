import { NextRequest, NextResponse } from "next/server";
import { inferenceAccess, body, failure } from "@/lib/server";
import { providerConfig } from "@/lib/ai-provider";
import { resumeSource } from "@/lib/resume";
import { extractResume } from "@/lib/resume-extraction";
export const runtime = "nodejs";
export const maxDuration = 200;
export async function POST(req: NextRequest) {
  try {
    await inferenceAccess(req);
    const source = resumeSource.parse(await body(req, 65000));
    return NextResponse.json(
      await extractResume(source, providerConfig(), req.signal),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

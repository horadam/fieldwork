import { NextRequest, NextResponse } from "next/server";
import {
  body,
  failure,
  inferenceAccess,
  reserveInference,
  HttpError,
} from "@/lib/server";
import { requestProvider } from "@/lib/ai-provider";
import { audioInput, transcribePractice } from "@/lib/practice-audio";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  try {
    const access = await inferenceAccess(req),
      config = requestProvider(req.headers);
    if (config.provider !== "openai")
      throw new HttpError(
        400,
        "Select OpenAI to transcribe voice. Ollama text practice stays available; no fallback was made.",
      );
    const input = audioInput.parse(await body(req, 7000000));
    await reserveInference(access, "practice_audio", config);
    return NextResponse.json(
      await transcribePractice(input, config, req.signal),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

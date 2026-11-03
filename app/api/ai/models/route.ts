import { NextRequest, NextResponse } from "next/server";
import {
  AIError,
  availableModels,
  hasUserKey,
  requestProvider,
} from "@/lib/ai-provider";
import { DEFAULT_USER_MODEL } from "@/lib/pricing";
import { failure } from "@/lib/server";
export const runtime = "nodejs";
export const maxDuration = 15;
// Lists the models a visitor's own key can use. Free for the visitor, and it
// rejects a bad key before any billed call.
export async function GET(req: NextRequest) {
  try {
    if (!hasUserKey(req.headers))
      throw new AIError(
        "Add an OpenAI key to list its models.",
        "user_key_missing",
        400,
      );
    // The model header is irrelevant here; the suggested one always passes.
    const headers = new Headers(req.headers);
    headers.set("x-openai-model", DEFAULT_USER_MODEL);
    const models = await availableModels(requestProvider(headers), req.signal);
    return NextResponse.json(models, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

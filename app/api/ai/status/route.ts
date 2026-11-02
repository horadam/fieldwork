import { NextRequest, NextResponse } from "next/server";
import { providerConfig, providerStatus } from "@/lib/ai-provider";
import { inferenceAccess, failure } from "@/lib/server";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  try {
    const config = providerConfig();
    let allowed = true,
      accessMessage = "";
    try {
      await inferenceAccess(req);
    } catch {
      allowed = false;
      accessMessage =
        "Sign in, or enable LOCAL_WORKSPACE_ENABLED=true in development on localhost.";
    }
    // Public response is non-secret and never queries model readiness for disallowed callers.
    const status = allowed
      ? await providerStatus(config)
      : { ...config, ready: false, message: accessMessage };
    return NextResponse.json(
      { ...status, allowed },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

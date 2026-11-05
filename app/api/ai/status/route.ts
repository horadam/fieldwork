import { NextRequest, NextResponse } from "next/server";
import { requestProvider, providerStatus } from "@/lib/ai-provider";
import { accessHint } from "@/lib/deployment";
import { inferenceAccess, failure, localWorkspaceAllowed } from "@/lib/server";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  try {
    const config = requestProvider(req.headers);
    let allowed = true;
    try {
      await inferenceAccess(req);
    } catch {
      allowed = false;
    }
    // Public response is non-secret and never queries model readiness for disallowed callers.
    const status = allowed
      ? await providerStatus(config)
      : { ...config, ready: false, message: accessHint() };
    // `local` is the account-less development mode; hosted copies explain
    // themselves to visitors instead.
    return NextResponse.json(
      { ...status, allowed, local: localWorkspaceAllowed(req) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

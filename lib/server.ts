import { AIError } from "./ai-provider";
import { supabaseConfig } from "./supabase-config";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function authenticated(req: NextRequest) {
  let config;
  try {
    config = supabaseConfig(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  } catch (error) {
    throw new HttpError(
      503,
      error instanceof Error
        ? error.message
        : "Supabase configuration is invalid.",
    );
  }
  if (!config)
    throw new HttpError(
      503,
      "Account storage is not configured. Use the browser workspace.",
    );
  const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, "Sign in to continue.");
  const db = createClient(config.url, config.key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user)
    throw new HttpError(401, "Your session expired. Sign in again.");
  return { db, user: data.user };
}
export async function body(req: NextRequest, limit = 35000) {
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Request body is required.");
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      text += decoder.decode(chunk.value, { stream: true });
      if (bytes > limit * 4 || text.length > limit) {
        await reader.cancel();
        throw new HttpError(413, "Request is too large.");
      }
    }
    text += decoder.decode();
    if (text.length > limit) throw new HttpError(413, "Request is too large.");
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid request body.");
  }
}
export function failure(error: unknown) {
  if (error instanceof AIError)
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  if (error instanceof HttpError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error && typeof error === "object" && "issues" in error)
    return NextResponse.json(
      { error: "Check the form fields and try again." },
      { status: 400 },
    );
  // Do not send provider/database diagnostics or personal source material to the browser/logs.
  return NextResponse.json(
    {
      error:
        "The request could not be completed. Check configuration and retry.",
    },
    { status: 500 },
  );
}

const loopback = (hostname: string) =>
  ["127.0.0.1", "localhost", "[::1]"].includes(hostname);
export function localWorkspaceAllowed(req: NextRequest) {
  const url = new URL(req.url);
  const host = req.headers.get("host");
  let hosting: URL;
  try {
    hosting = new URL(`${url.protocol}//${host}`);
  } catch {
    return false;
  }
  // Hosting flags block accidental exposure even if development settings are copied.
  return (
    process.env.LOCAL_WORKSPACE_ENABLED === "true" &&
    process.env.NODE_ENV === "development" &&
    !process.env.VERCEL &&
    !process.env.NETLIFY &&
    !process.env.RENDER &&
    !process.env.RAILWAY_ENVIRONMENT &&
    loopback(url.hostname) &&
    loopback(hosting.hostname) &&
    hosting.port === url.port &&
    (req.headers.get("origin") === hosting.origin ||
      (req.method === "GET" &&
        req.headers.get("sec-fetch-site") === "same-origin" &&
        !!req.headers.get("referer") &&
        new URL(req.headers.get("referer")!).origin === hosting.origin)) &&
    (!req.headers.get("sec-fetch-site") ||
      req.headers.get("sec-fetch-site") === "same-origin") &&
    // Next itself supplies these forwarding headers, even without a proxy.
    (!req.headers.has("x-forwarded-host") ||
      req.headers.get("x-forwarded-host") === host) &&
    (!req.headers.has("x-forwarded-for") ||
      req.headers
        .get("x-forwarded-for")!
        .split(",")
        .every((ip) =>
          ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip.trim()),
        )) &&
    (!req.headers.has("x-forwarded-proto") ||
      req.headers.get("x-forwarded-proto") === url.protocol.slice(0, -1)) &&
    !req.headers.has("forwarded")
  );
}
export async function inferenceAccess(req: NextRequest, localOnly = false) {
  if (req.headers.get("authorization")?.match(/^Bearer (.+)$/)) {
    if (localOnly)
      throw new HttpError(
        403,
        "Use authenticated workspace analysis for your account.",
      );
    return authenticated(req);
  }
  if (!localWorkspaceAllowed(req))
    throw new HttpError(
      403,
      "Local inference requires LOCAL_WORKSPACE_ENABLED=true, development mode, loopback hosting, and a same-origin request. Hosted use requires sign-in.",
    );
  return null;
}

export type InferenceKind =
  | "resume_extraction"
  | "job_extraction"
  | "preparation_generation";
// Hosted (signed-in) calls spend the per-hour quota in 005_inference_usage.sql;
// local development calls (no account) are not metered.
export async function reserveInference(
  access: Awaited<ReturnType<typeof inferenceAccess>>,
  kind: InferenceKind,
) {
  if (!access) return;
  const { error } = await access.db.rpc("reserve_inference", { p_kind: kind });
  if (!error) return;
  if (error.message.includes("Hourly"))
    throw new HttpError(
      429,
      "Hourly limit for this action reached. Try later.",
    );
  throw new HttpError(
    503,
    "Could not check your usage quota. Apply the latest database migration and retry.",
  );
}

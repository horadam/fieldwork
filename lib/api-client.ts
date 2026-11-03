// Browser-side JSON client for the app's own API routes.
import type { CallRecord } from "./pricing";
import {
  getUserKey,
  recordUsage,
  type UserKey,
  USER_KEY_HEADER,
  USER_MODEL_HEADER,
} from "./user-key";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export type Request = <T = unknown>(
  path: string,
  options?: {
    body?: unknown;
    token?: string;
    signal?: AbortSignal;
    // A key to try before it is saved, e.g. while listing its models.
    userKey?: UserKey;
  },
) => Promise<T>;

// Model calls report usage as `metadata` (extraction and plans), `usage`
// (account analysis and failures) or top-level fields (browser analysis).
export function usageFrom(body: unknown): CallRecord | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  for (const candidate of [record.metadata, record.usage, record]) {
    const c = candidate as Record<string, unknown> | undefined;
    if (
      c &&
      typeof c.inputTokens === "number" &&
      typeof c.outputTokens === "number"
    )
      return {
        provider: typeof c.provider === "string" ? c.provider : undefined,
        model: typeof c.model === "string" ? c.model : undefined,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
      };
  }
  return null;
}

// `token` is read per call so a signed-in session is always current. A
// visitor's own OpenAI key, when set, rides along on every request.
export function apiClient(token: () => string): Request {
  return async (path, options = {}) => {
    const bearer = options.token ?? token();
    const userKey = options.userKey ?? getUserKey();
    const response = await fetch(path, {
      signal: options.signal,
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(userKey
          ? {
              [USER_KEY_HEADER]: userKey.key,
              [USER_MODEL_HEADER]: userKey.model,
            }
          : {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    let result: { error?: string; code?: string } = {};
    try {
      result = await response.json();
    } catch {
      /* A non-JSON body is reported by status below. */
    }
    // Failed calls can still be billed, so they count too.
    const usage = usageFrom(result);
    if (usage && (usage.inputTokens || usage.outputTokens)) recordUsage(usage);
    if (!response.ok)
      throw new ApiError(
        result.error || `Request failed (HTTP ${response.status}).`,
        response.status,
        result.code,
      );
    return result as never;
  };
}

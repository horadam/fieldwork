// Browser-side JSON client for the app's own API routes.
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
  options?: { body?: unknown; token?: string; signal?: AbortSignal },
) => Promise<T>;

// `token` is read per call so a signed-in session is always current.
export function apiClient(token: () => string): Request {
  return async (path, options = {}) => {
    const bearer = options.token ?? token();
    const response = await fetch(path, {
      signal: options.signal,
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
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
    if (!response.ok)
      throw new ApiError(
        result.error || `Request failed (HTTP ${response.status}).`,
        response.status,
        result.code,
      );
    return result as never;
  };
}

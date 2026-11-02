import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request }));
import { httpsPage, MAX_PAGE_BYTES } from "../lib/job-page";
afterEach(() => vi.clearAllMocks());
function socket(
  headers: Record<string, string | undefined>,
  chunks: string[],
  status = 200,
) {
  const response = Object.assign(new EventEmitter(), {
    statusCode: status,
    headers,
    destroy: vi.fn((error?: Error) => {
      if (error) response.emit("error", error);
    }),
  });
  request.mockImplementation((_url, _options, callback) => {
    const req = Object.assign(new EventEmitter(), {
      end: () =>
        queueMicrotask(() => {
          callback(response);
          if (!response.destroy.mock.calls.length) {
            for (const chunk of chunks)
              response.emit("data", Buffer.from(chunk));
            response.emit("end");
          }
        }),
    });
    return req;
  });
  return response;
}
it("connects through pinned DNS while retaining the original URL/TLS hostname and sending no credentials", async () => {
  socket({ "content-type": "text/html" }, ["<main>Readable page</main>"]);
  const url = new URL("https://careers.example.com/job");
  const result = await httpsPage(
    url,
    { address: "8.8.8.8", family: 4 },
    new AbortController().signal,
  );
  const [target, options] = request.mock.calls[0];
  expect(target).toBe(url);
  expect(options.family).toBe(4);
  expect(options.agent).toBe(false);
  expect(options.rejectUnauthorized).not.toBe(false);
  const callback = vi.fn();
  options.lookup("careers.example.com", {}, callback);
  expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  expect(options.headers.Cookie).toBeUndefined();
  expect(options.headers.Authorization).toBeUndefined();
  expect(options.headers["Accept-Encoding"]).toBe("identity");
  expect(new TextDecoder().decode(result.body)).toContain("Readable page");
});
it.each([
  { "content-type": "application/pdf" },
  { "content-type": "text/html", "content-encoding": "gzip" },
  { "content-type": "text/html", "content-length": String(MAX_PAGE_BYTES + 1) },
])("rejects unsupported or oversized response headers %j", async (headers) => {
  const response = socket(headers, []);
  await expect(
    httpsPage(
      new URL("https://example.com"),
      { address: "8.8.8.8", family: 4 },
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(response.destroy).toHaveBeenCalled();
});
it("enforces streamed byte limits without trusting content-length", async () => {
  const response = socket({ "content-type": "text/html" }, [
    "x".repeat(MAX_PAGE_BYTES),
    "extra",
  ]);
  await expect(
    httpsPage(
      new URL("https://example.com"),
      { address: "8.8.8.8", family: 4 },
      new AbortController().signal,
    ),
  ).rejects.toThrow("too large");
  expect(response.destroy).toHaveBeenCalled();
});
it("returns redirects for the outer validator without consuming their bodies", async () => {
  const response = socket({ location: "https://127.0.0.1" }, [], 302);
  const result = await httpsPage(
    new URL("https://example.com"),
    { address: "8.8.8.8", family: 4 },
    new AbortController().signal,
  );
  expect(result.location).toBe("https://127.0.0.1");
  expect(result.body.length).toBe(0);
  expect(response.destroy).toHaveBeenCalled();
});
it("accepts JSON only on the fixed public Gem job API path", async () => {
  socket({ "content-type": "application/json" }, ["{}"]);
  await expect(
    httpsPage(
      new URL("https://api.gem.com/job_board/v0/example/job_posts/job_123"),
      { address: "8.8.8.8", family: 4 },
      new AbortController().signal,
    ),
  ).resolves.toHaveProperty("status", 200);
  for (const url of [
    "https://example.com/jobs",
    "https://api.gem.com/other",
    "https://api.gem.com.evil.com/job_board/v0/example/job_posts/job_123",
  ]) {
    socket({ "content-type": "application/json" }, ["{}"]);
    await expect(
      httpsPage(
        new URL(url),
        { address: "8.8.8.8", family: 4 },
        new AbortController().signal,
      ),
    ).rejects.toThrow("HTML/text");
  }
});

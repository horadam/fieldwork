import { describe, expect, it, vi } from "vitest";
import { fetchJobPage, MAX_PAGE_BYTES } from "../lib/job-page";
const url = "https://jobs.gem.com/example/job_123?source=linkedin";
const description =
  "<p>Build accessible React interfaces and Node APIs with our product team. Own testing, reliability and delivery of customer features.</p>";
const job = {
  id: "job_123",
  title: "Engineer",
  company_name: "Example",
  description,
};
const shell = {
  status: 200,
  contentType: "text/html",
  body: new TextEncoder().encode(
    '<html><div id="root"></div><script src="app.js"></script></html>',
  ),
};
const json = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: new TextEncoder().encode(JSON.stringify(data)),
});
const resolve = async () => [{ address: "8.8.8.8", family: 4 }];
describe("Gem public job data adapter", () => {
  it("reads a matching job when the page is a JavaScript shell, preserving the source URL", async () => {
    const transport = vi.fn(async (target: URL) =>
      target.hostname === "jobs.gem.com" ? shell : json(job),
    );
    const result = await fetchJobPage(url, undefined, { resolve, transport });
    expect(transport.mock.calls.map((call) => call[0].href)).toEqual([
      url,
      "https://api.gem.com/job_board/v0/example/job_posts/job_123",
    ]);
    expect(result.text).toContain("Example\n\nEngineer");
    expect(result.text).toContain("Own testing");
    expect(result.url).toBe(url);
    expect(result.warnings[0]).toContain("Gem");
  });
  it("uses the documented board list only after an individual 404 and selects by exact URL", async () => {
    const transport = vi.fn(async (target: URL) =>
      target.hostname === "jobs.gem.com"
        ? shell
        : target.pathname.endsWith("/job_123")
          ? { ...shell, status: 404 }
          : json({
              job_posts: [
                {
                  ...job,
                  id: "other",
                  absolute_url: "https://jobs.gem.com/example/other",
                },
                {
                  ...job,
                  id: "internal-id",
                  absolute_url:
                    "https://jobs.gem.com/example/job_123?tracking=a",
                },
              ],
            }),
    );
    const result = await fetchJobPage(url, undefined, { resolve, transport });
    expect(result.text).toContain("Engineer");
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it.each([
    { ...job, id: "different" },
    { job_posts: [job, job] },
    { ...job, description: "" },
    {
      job_posts: [
        {
          ...job,
          id: "different",
          absolute_url: "https://jobs.gem.com/another/job_123",
        },
      ],
    },
    { error: "private upstream diagnostic" },
  ])("refuses ambiguous, missing, or unrelated job data", async (data) => {
    await expect(
      fetchJobPage(url, undefined, {
        resolve,
        transport: async (target) =>
          target.hostname === "jobs.gem.com" ? shell : json(data),
      }),
    ).rejects.toThrow("matching description");
  });
  it("does not request API data for normal readable HTML", async () => {
    const transport = vi.fn(async () => ({
      ...shell,
      body: new TextEncoder().encode(description),
    }));
    await fetchJobPage(url, undefined, { resolve, transport });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("does not route lookalike hosts to Gem or leak URL credentials/query into the API", async () => {
    const transport = vi.fn(async () => shell);
    await expect(
      fetchJobPage("https://jobs.gem.com.evil.com/example/job_123", undefined, {
        resolve,
        transport,
      }),
    ).rejects.toThrow("JavaScript");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("checks DNS for the API connection and never connects to a private answer", async () => {
    const transport = vi.fn(async () => shell);
    await expect(
      fetchJobPage(url, undefined, {
        resolve: async (host) => [
          {
            address: host === "api.gem.com" ? "127.0.0.1" : "8.8.8.8",
            family: 4,
          },
        ],
        transport,
      }),
    ).rejects.toThrow("matching description");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects redirects from the API to private addresses before opening another connection", async () => {
    const transport = vi.fn(async (target) =>
      target.hostname === "jobs.gem.com"
        ? shell
        : { ...shell, status: 302, location: "https://169.254.169.254" },
    );
    await expect(
      fetchJobPage(url, undefined, { resolve, transport }),
    ).rejects.toThrow("matching description");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("rejects oversized API bodies and malformed JSON without sending anything to AI", async () => {
    for (const body of [
      new Uint8Array(MAX_PAGE_BYTES + 1),
      new TextEncoder().encode("invalid JSON"),
    ])
      await expect(
        fetchJobPage(url, undefined, {
          resolve,
          transport: async (target) =>
            target.hostname === "jobs.gem.com"
              ? shell
              : { status: 200, contentType: "application/json", body },
        }),
      ).rejects.toThrow("matching description");
  });
  it("retains the source limit for a matched description", async () => {
    await expect(
      fetchJobPage(url, undefined, {
        resolve,
        transport: async (target) =>
          target.hostname === "jobs.gem.com"
            ? shell
            : json({ ...job, description: "x".repeat(30001) }),
      }),
    ).rejects.toThrow("too much text");
  });
  it("does not retry an API rate limit through another endpoint", async () => {
    const transport = vi.fn(async (target) =>
      target.hostname === "jobs.gem.com" ? shell : { ...shell, status: 429 },
    );
    await expect(
      fetchJobPage(url, undefined, { resolve, transport }),
    ).rejects.toThrow("matching description");
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchJobPage,
  extractPageText,
  publicPageUrl,
  publicAddress,
  MAX_PAGE_BYTES,
} from "../lib/job-page";
import { extractJob } from "../lib/job-extraction";
const text =
  "Acme is hiring a full-stack engineer. Build accessible React applications and reliable Node APIs. Work with product and design.";
const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
const page = (body = text, status = 200, location?: string) => ({
  status,
  location,
  contentType: "text/html",
  body: new TextEncoder().encode(body),
});
const config = {
  provider: "ollama" as const,
  model: "qwen3:8b",
  deadlineMs: 180000,
};
const draft = {
  company: "Acme",
  role: "Full-stack engineer",
  jd: text,
  warnings: [],
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("public page fetching", () => {
  it.each([
    "http://example.com/job",
    "file:///etc/passwd",
    "https://user:pass@example.com",
    "https://example.com:8443",
    "https://localhost/job",
    "https://internal.local/job",
    "https://127.1/job",
    "https://2130706433/job",
    "https://[::1]/job",
    "https://[::ffff:127.0.0.1]/job",
    "https://169.254.169.254/latest",
    "https://10.1.1.1/job",
  ])("rejects unsafe URL %s", (url) =>
    expect(() => publicPageUrl(url)).toThrow(),
  );
  it.each([
    "0.0.0.0",
    "100.100.100.200",
    "192.168.1.1",
    "172.31.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "64:ff9b::7f00:1",
  ])("rejects reserved/private address %s", (ip) =>
    expect(publicAddress(ip)).toBe(false),
  );
  it("accepts public v4/v6 and strips fragments", () => {
    expect(publicAddress("8.8.8.8")).toBe(true);
    expect(publicAddress("2606:4700:4700::1111")).toBe(true);
    expect(publicPageUrl("https://example.com/job#apply").href).toBe(
      "https://example.com/job",
    );
  });
  it("pins a checked address and follows a checked public redirect", async () => {
    const transport = vi.fn(async (url: URL, address: { address: string }) => {
      expect(address.address).toBe("93.184.216.34");
      return url.pathname === "/job"
        ? page("", 302, "https://careers.example.com/role")
        : page(`<main>${text}</main>`);
    });
    const result = await fetchJobPage("https://example.com/job", undefined, {
      resolve,
      transport,
    });
    expect(result.text).toBe(text);
    expect(result.url).toBe("https://careers.example.com/role");
    expect(resolve.mock.calls).toEqual([
      ["example.com"],
      ["careers.example.com"],
    ]);
  });
  it("rejects mixed DNS answers before connecting", async () => {
    const transport = vi.fn();
    await expect(
      fetchJobPage("https://example.com", undefined, {
        resolve: async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
        transport,
      }),
    ).rejects.toThrow("public");
    expect(transport).not.toHaveBeenCalled();
  });
  it("rechecks DNS after redirects and blocks a private destination", async () => {
    const transport = vi.fn(async () =>
      page("", 302, "https://private.example.com"),
    );
    await expect(
      fetchJobPage("https://example.com", undefined, {
        resolve: async (host) => [
          {
            address: host.startsWith("private") ? "10.0.0.1" : "8.8.8.8",
            family: 4,
          },
        ],
        transport,
      }),
    ).rejects.toThrow("public");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    "http://example.com/job",
    "https://localhost/job",
    "https://169.254.169.254",
  ])("blocks redirect to %s", async (location) => {
    const transport = vi.fn(async () => page("", 302, location));
    await expect(
      fetchJobPage("https://example.com", undefined, { resolve, transport }),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("bounds redirect chains and detects loops", async () => {
    let n = 0;
    const transport = vi.fn(async () => page("", 302, `/job/${++n}`));
    await expect(
      fetchJobPage("https://example.com", undefined, { resolve, transport }),
    ).rejects.toThrow("too many");
    expect(transport).toHaveBeenCalledTimes(4);
    await expect(
      fetchJobPage("https://example.com", undefined, {
        resolve,
        transport: async () => page("", 302, "/"),
      }),
    ).rejects.toThrow("loop");
  });
  it("rejects oversized responses, oversized text, blocked pages and empty shells", async () => {
    for (const [response, message] of [
      [page("x".repeat(MAX_PAGE_BYTES + 1)), "too large"],
      [page("x".repeat(30001)), "too much"],
      [page("", 403), "HTTP 403"],
      [page("<main>Loading…</main>"), "JavaScript"],
    ] as const)
      await expect(
        fetchJobPage("https://example.com", undefined, {
          resolve,
          transport: async () => response,
        }),
      ).rejects.toThrow(message);
  });
  it("cancels before connecting", async () => {
    const control = new AbortController();
    control.abort();
    const transport = vi.fn();
    await expect(
      fetchJobPage("https://example.com", control.signal, {
        resolve,
        transport,
      }),
    ).rejects.toThrow("cancelled");
    expect(transport).not.toHaveBeenCalled();
  });
});
describe("readable page extraction", () => {
  it("removes executable/navigation content, decodes entities, and keeps list boundaries", () => {
    const result = extractPageText(
      `<title>Engineer &amp; Acme</title><nav>Other jobs</nav><main><h1>Engineer</h1><script>alert('no')</script><style>bad</style><p>React &amp; Node &#x2022; APIs</p><ul><li>Own UX</li><li>Ship safely</li></ul></main><footer>Footer</footer>`,
    );
    expect(result.title).toBe("Engineer & Acme");
    expect(result.text).toContain("React & Node • APIs");
    expect(result.text).toContain("Own UX\nShip safely");
    expect(result.text).not.toMatch(/alert|Other jobs|Footer|bad/);
  });
  it("prefers one structured job listing over a JS shell", () => {
    const data = {
      "@graph": [
        {
          "@type": "JobPosting",
          title: "Engineer",
          hiringOrganization: { name: "Acme" },
          description: `<p>${text}</p>`,
        },
      ],
    };
    const result = extractPageText(
      `<script type="application/ld+json">${JSON.stringify(data)}</script><main>Loading</main>`,
    );
    expect(result.text).toBe(`Engineer\n\nAcme\n\n${text}`);
    expect(result.warnings[0]).toContain("structured");
  });
  it("falls back for malformed or multiple structured listings", () => {
    expect(
      extractPageText(
        `<script type="application/ld+json">oops</script><article>${text}</article>`,
      ).text,
    ).toBe(text);
    const result = extractPageText(
      `<script type="application/ld+json">[{"@type":"JobPosting"},{"@type":"JobPosting"}]</script><main>${text}</main>`,
    );
    expect(result.warnings[0]).toContain("multiple jobs");
  });
});
describe("single-call job extraction", () => {
  it("uses only inspected text with native local schema and no tools or fallback", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        message: { content: JSON.stringify(draft) },
        done: true,
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await extractJob(text, config);
    expect(result.metadata.provider).toBe("ollama");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    const payload = JSON.parse(init.body as string);
    expect(payload.format.type).toBe("object");
    expect(payload.think).toBe(false);
    expect(payload.tools).toBeUndefined();
    expect(JSON.parse(payload.messages[1].content).sourceText).toBe(text);
    expect(payload.messages[0].content).toContain("untrusted");
  });
  it.each([
    ["bad JSON", { message: { content: "bad" } }, "invalid JSON"],
    [
      "invalid fields",
      { message: { content: JSON.stringify({ ...draft, company: 2 }) } },
      "invalid fields",
    ],
    [
      "no JD",
      { message: { content: JSON.stringify({ ...draft, jd: "" }) } },
      "No useful",
    ],
    [
      "over-long JD",
      {
        message: {
          content: JSON.stringify({ ...draft, jd: "x".repeat(15001) }),
        },
      },
      "longer than 15,000 characters",
    ],
    ["truncated", { done_reason: "length" }, "output limit"],
  ])("rejects %s without retry", async (_name, value, message) => {
    const fetcher = vi.fn(async () => Response.json(value));
    vi.stubGlobal("fetch", fetcher);
    await expect(extractJob(text, config)).rejects.toThrow(message as string);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reports a missing model without paid fallback", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(extractJob(text, config)).rejects.toThrow(
      "Install it separately",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("stops at the provider deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url, init) =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener("abort", () =>
              reject(new Error("abort")),
            ),
          ),
      ),
    );
    await expect(
      extractJob(text, { ...config, deadlineMs: 15 }),
    ).rejects.toThrow("timed out");
  });
  it("preserves explicit OpenAI structured output without automatic retries", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic");
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(init.body as string);
      expect(payload.response_format.type).toBe("json_schema");
      expect(payload.tools).toBeUndefined();
      return Response.json({
        id: "test",
        object: "chat.completion",
        created: 1,
        model: "test",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: JSON.stringify(draft) },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetcher);
    await extractJob(text, {
      provider: "openai",
      model: "test",
      deadlineMs: 45000,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });
});

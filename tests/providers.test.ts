import { afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  providerConfig,
  providerStatus,
  openAIClient,
  OLLAMA_URL,
} from "../lib/ai-provider";
import { extractResume } from "../lib/resume-extraction";
import { localWorkspaceAllowed, inferenceAccess, body } from "../lib/server";
const config = {
  provider: "ollama" as const,
  model: "qwen3:8b",
  deadlineMs: 180000,
};
const text = "Acme Engineer 2020–2022. Helped build a React interface.";
const output = {
  drafts: [
    {
      kind: "role",
      organization: "Acme",
      role: "Engineer",
      dates: "2020–2022",
      accomplishments: ["Helped build a React interface."],
      passages: [{ quote: "Helped build a React interface.", page: null }],
      warnings: [],
    },
  ],
  warnings: [],
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("provider boundaries", () => {
  it("defaults to Ollama and configures clients without paid fallback or SDK retries", () => {
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("OLLAMA_MODEL", "");
    expect(providerConfig()).toEqual(config);
    const client = openAIClient(config);
    expect(client.baseURL).toBe(`${OLLAMA_URL}/v1`);
    expect(client.maxRetries).toBe(0);
  });
  it("requires explicit valid provider and OpenAI configuration", () => {
    vi.stubEnv("AI_PROVIDER", "bad");
    expect(() => providerConfig()).toThrow("AI_PROVIDER");
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_MODEL", "test");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => openAIClient(providerConfig())).toThrow("OPENAI_API_KEY");
  });
  it("blocks cloud-routed model names", () => {
    vi.stubEnv("OLLAMA_MODEL", "qwen3:cloud");
    expect(() => providerConfig()).toThrow("local model");
  });
  it("uses one native structured local extraction call with no tools", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({
        message: { content: JSON.stringify(output) },
        prompt_eval_count: 10,
        eval_count: 20,
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await extractResume({ text, pages: [] }, config);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(`${OLLAMA_URL}/api/chat`);
    const payload = JSON.parse(
      (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    );
    expect(payload.format.type).toBe("object");
    expect(payload.tools).toBeUndefined();
    expect(result.metadata.provider).toBe("ollama");
  });
  it.each(["offline", "invalid JSON"])(
    "fails closed on %s without fallback",
    async (mode) => {
      const fetcher = vi.fn(async () => {
        if (mode === "offline") throw new Error("offline");
        return Response.json({
          message: {
            content:
              mode === "invalid JSON"
                ? "oops"
                : JSON.stringify({
                    ...output,
                    drafts: [
                      {
                        ...output.drafts[0],
                        passages: [{ quote: "Invented", page: null }],
                      },
                    ],
                  }),
          },
        });
      });
      vi.stubGlobal("fetch", fetcher);
      await expect(extractResume({ text, pages: [] }, config)).rejects.toThrow(
        "No OpenAI",
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("returns actionable readiness without exposing diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("private diagnostic");
      }),
    );
    const status = await providerStatus(config);
    expect(status.ready).toBe(false);
    expect(status.message).toContain("ollama pull");
    expect(status.message).not.toContain("diagnostic");
  });
  it("passes cancellation to the provider", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        expect(init.signal.aborted).toBe(true);
        throw new Error("aborted");
      }),
    );
    await expect(
      extractResume({ text, pages: [] }, config, controller.signal),
    ).rejects.toThrow("cancelled");
  });
});
function request(
  origin = "http://127.0.0.1:3000",
  headers: Record<string, string> = {},
) {
  return new NextRequest("http://127.0.0.1:3000/api/resume/extract", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", origin, ...headers },
  });
}
describe("local access restrictions", () => {
  it("requires explicit development opt-in and same origin", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_WORKSPACE_ENABLED", "true");
    expect(localWorkspaceAllowed(request())).toBe(true);
    expect(localWorkspaceAllowed(request("https://evil.example"))).toBe(false);
    vi.stubEnv("LOCAL_WORKSPACE_ENABLED", "false");
    expect(localWorkspaceAllowed(request())).toBe(false);
  });
  it("rejects production and hosted execution even with opt-in", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_WORKSPACE_ENABLED", "true");
    expect(localWorkspaceAllowed(request())).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "1");
    expect(localWorkspaceAllowed(request())).toBe(false);
  });
  it("rejects proxy headers and cross-site callers", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_WORKSPACE_ENABLED", "true");
    expect(
      localWorkspaceAllowed(
        request(undefined, { "x-forwarded-host": "example.com" }),
      ),
    ).toBe(false);
    await expect(
      inferenceAccess(request("https://evil.example")),
    ).rejects.toThrow("same-origin");
  });
});

it("terminates extraction at the configured deadline without retry", async () => {
  const fetcher = vi.fn(
    async (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    extractResume({ text, pages: [] }, { ...config, deadlineMs: 15 }),
  ).rejects.toThrow("timed out");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("bounds request bodies while streaming", async () => {
  const req = new NextRequest("http://localhost/api/test", {
    method: "POST",
    body: JSON.stringify({ text: "x".repeat(1000) }),
  });
  await expect(body(req, 100)).rejects.toThrow("too large");
});

it("accepts Next-generated loopback forwarding headers and same-origin status GET", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("LOCAL_WORKSPACE_ENABLED", "true");
  expect(
    localWorkspaceAllowed(
      request(undefined, {
        "x-forwarded-host": "127.0.0.1:3000",
        "x-forwarded-for": "::1",
        "x-forwarded-proto": "http",
      }),
    ),
  ).toBe(true);
  expect(
    localWorkspaceAllowed(
      request(undefined, { "x-forwarded-for": "203.0.113.4" }),
    ),
  ).toBe(false);
  const status = new NextRequest("http://127.0.0.1:3000/api/ai/status", {
    headers: {
      host: "127.0.0.1:3000",
      referer: "http://127.0.0.1:3000/",
      "sec-fetch-site": "same-origin",
    },
  });
  expect(localWorkspaceAllowed(status)).toBe(true);
});

it.each([
  { status: 404, code: "ollama_model_missing", message: "could not find" },
  {
    status: 400,
    code: "ollama_request_rejected",
    message: "structured request",
  },
  { status: 503, code: "ollama_busy", message: "busy" },
  { status: 500, code: "ollama_server_error", message: "HTTP 500" },
])(
  "distinguishes Ollama HTTP $status without exposing response bodies",
  async ({ status, code, message }) => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: "PRIVATE_RESUME_CONTENT" }, { status }),
    );
    vi.stubGlobal("fetch", fetcher);
    const error = await extractResume({ text, pages: [] }, config).catch(
      (e) => e,
    );
    expect(error.code).toBe(code);
    expect(error.message).toContain(message);
    expect(error.message).not.toContain("PRIVATE_RESUME");
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it.each([
  { content: "not JSON", code: "resume_invalid_json" },
  {
    content: JSON.stringify({
      drafts: [{ ...output.drafts[0], dates: null }],
      warnings: [],
    }),
    code: "resume_invalid_drafts",
  },
])("reports output rejection stage $code", async ({ content, code }) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ message: { content }, done: true, done_reason: "stop" }),
    ),
  );
  const error = await extractResume({ text, pages: [] }, config).catch(
    (e) => e,
  );
  expect(error.code).toBe(code);
  expect(error.message).toContain("No OpenAI");
});
it("distinguishes token exhaustion from a timeout", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        message: { content: '{"drafts":[' },
        done: true,
        done_reason: "length",
      }),
    ),
  );
  const error = await extractResume({ text, pages: [] }, config).catch(
    (e) => e,
  );
  expect(error.code).toBe("resume_truncated");
  expect(error.message).toContain("output limit");
});
it("reports connection errors without exposing provider diagnostics", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("PRIVATE_CONTENT", {
        cause: { code: "ECONNREFUSED" },
      });
    }),
  );
  const error = await extractResume({ text, pages: [] }, config).catch(
    (e) => e,
  );
  expect(error.code).toBe("ollama_unreachable");
  expect(error.message).not.toContain("PRIVATE_CONTENT");
});
it("returns diagnostic codes and correct status to the caller", async () => {
  const { failure } = await import("../lib/server");
  const { AIError } = await import("../lib/ai-provider");
  const response = failure(
    new AIError("Timed out safely", "inference_timeout", 504),
  );
  expect(response.status).toBe(504);
  expect(await response.json()).toEqual({
    error: "Timed out safely",
    code: "inference_timeout",
  });
});

it("extracts roles without generating citations or requiring source passages", async () => {
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(init.body as string);
    expect(JSON.stringify(payload.format)).not.toContain("passages");
    expect(payload.messages[1].content).not.toContain('"pages":');
    return Response.json({
      message: { content: JSON.stringify(output) },
      done: true,
      done_reason: "stop",
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await extractResume({ text, pages: [] }, config);
  expect(result.output.drafts).toHaveLength(1);
  expect(result.output.drafts[0]).not.toHaveProperty("passages");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

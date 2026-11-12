import OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ extractResume: vi.fn() }));
vi.mock("../lib/resume-extraction", async (original) => ({
  ...(await original<typeof import("../lib/resume-extraction")>()),
  extractResume: mocks.extractResume,
}));
import {
  AIError,
  openAIClient,
  providerError,
  providerStatus,
  requestProvider,
} from "../lib/ai-provider";
import { failure, inferenceAccess, reserveInference } from "../lib/server";
import { POST as extractResume } from "../app/api/resume/extract/route";
import { POST as fetchJob } from "../app/api/jobs/fetch/route";
import { GET as status } from "../app/api/ai/status/route";
import { GET as listModels } from "../app/api/ai/models/route";

const key = "sk-test_" + "a".repeat(40);
const hosted = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`https://fieldwork.vercel.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      text: "Acme · Engineer · 2020–2022. Built React interfaces.",
      pages: [],
    }),
  });
const withKey = { "x-openai-key": key, "x-openai-model": "gpt-6.1-terra" };
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a visitor's own OpenAI key", () => {
  it("builds an OpenAI config that never serializes the key", () => {
    const config = requestProvider(new Headers(withKey));
    expect(config).toEqual({
      provider: "openai",
      model: "gpt-6.1-terra",
      deadlineMs: 45000,
    });
    expect(config.apiKey).toBe(key);
    expect(JSON.stringify(config)).not.toContain(key);
    expect({ ...config }).not.toHaveProperty("apiKey");
  });

  it("falls back to the server's provider without the header", () => {
    vi.stubEnv("AI_PROVIDER", "ollama");
    expect(requestProvider(new Headers()).provider).toBe("ollama");
  });

  it("uses the suggested model when none is sent", () => {
    expect(requestProvider(new Headers({ "x-openai-key": key })).model).toBe(
      "gpt-6.1-terra",
    );
  });

  it.each([
    [{ "x-openai-key": "not-a-key" }, "user_key_invalid"],
    [
      { "x-openai-key": key, "x-openai-model": "../evil" },
      "user_model_invalid",
    ],
  ])("rejects malformed input %#", (headers, code) => {
    expect(() => requestProvider(new Headers(headers))).toThrow(
      expect.objectContaining({ code, status: 400 }),
    );
  });

  it("calls OpenAI with the visitor's key even without a server key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const client = openAIClient(requestProvider(new Headers(withKey)));
    expect(client.apiKey).toBe(key);
    expect(client.baseURL).toBe("https://api.openai.com/v1");
    expect(client.maxRetries).toBe(0);
  });

  it.each([
    [401, "openai_key_rejected", 400],
    [429, "openai_rate_limited", 429],
    [404, "openai_model_unavailable", 400],
  ])(
    "maps OpenAI HTTP %i without echoing the key",
    (httpStatus, code, status) => {
      const config = requestProvider(new Headers(withKey));
      const error = providerError(config, {
        status: httpStatus,
        message: `Incorrect API key provided: ${key}`,
      });
      expect(error).toMatchObject({ code, status });
      expect(error.message).toMatch(/your/i);
      expect(error.message).not.toContain(key);
    },
  );

  it.each([
    [400, "openai_request_rejected", 400],
    [503, "openai_server_error", 502],
  ])(
    "names OpenAI HTTP %i instead of a generic failure",
    (httpStatus, code, status) => {
      const config = requestProvider(new Headers(withKey));
      const error = providerError(config, {
        status: httpStatus,
        message: `Incorrect API key provided: ${key}`,
      });
      expect(error).toMatchObject({ code, status });
      expect(error.message).toContain(`OpenAI ${httpStatus}`);
      expect(error.message).not.toContain(key);
    },
  );

  it("recognises the SDK's own timeout and connection errors", () => {
    const config = requestProvider(new Headers(withKey));
    expect(
      providerError(config, new OpenAI.APIConnectionTimeoutError()),
    ).toMatchObject({ code: "inference_timeout", status: 504 });
    const lost = providerError(
      config,
      new OpenAI.APIConnectionError({
        cause: Object.assign(new Error(key), { code: "ECONNRESET" }),
      }),
    );
    expect(lost).toMatchObject({ code: "openai_unreachable", status: 503 });
    expect(lost.message).toContain("ECONNRESET");
    expect(lost.message).not.toContain(key);
    const other = providerError(config, new TypeError(key));
    expect(other.message).toContain("(TypeError)");
    expect(other.message).not.toContain(key);
  });

  it("reports readiness without a test call or the key", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await providerStatus(requestProvider(new Headers(withKey)));
    expect(result).toMatchObject({ ready: true, source: "user" });
    expect(JSON.stringify(result)).not.toContain(key);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("hosted access with a visitor's key", () => {
  it("allows AI steps without an account in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    await expect(
      inferenceAccess(hosted("/api/resume/extract", withKey)),
    ).resolves.toBeNull();
    await expect(
      inferenceAccess(hosted("/api/resume/extract")),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("never opens URL fetching to a key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await fetchJob(hosted("/api/jobs/fetch", withKey));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("paste the job text");
  });

  it("rejects a malformed key instead of treating it as anonymous", async () => {
    await expect(
      inferenceAccess(
        hosted("/api/resume/extract", { "x-openai-key": "sk-short" }),
      ),
    ).rejects.toBeInstanceOf(AIError);
  });

  it("passes the key to the model call and skips the server quota", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.extractResume.mockResolvedValue({
      output: { drafts: [], warnings: [] },
      metadata: { provider: "openai", model: "gpt-6.1-terra" },
    });
    const response = await extractResume(
      hosted("/api/resume/extract", withKey),
    );
    expect(response.status).toBe(200);
    expect(mocks.extractResume.mock.calls[0][1].apiKey).toBe(key);
    expect(JSON.stringify(await response.json())).not.toContain(key);
  });

  it("meters signed-in calls on the server key only", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const access = { db: { rpc } } as never;
    await reserveInference(
      access,
      "resume_extraction",
      requestProvider(new Headers(withKey)),
    );
    expect(rpc).not.toHaveBeenCalled();
    await reserveInference(access, "resume_extraction", {
      provider: "openai",
      model: "gpt-6.1-terra",
      deadlineMs: 45000,
    });
    expect(rpc).toHaveBeenCalledWith("reserve_inference", {
      p_kind: "resume_extraction",
    });
  });

  it("reports the visitor's model in status", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await status(
      new NextRequest("https://fieldwork.vercel.app/api/ai/status", {
        headers: withKey,
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      allowed: true,
      ready: true,
      source: "user",
      provider: "openai",
      model: "gpt-6.1-terra",
    });
    expect(JSON.stringify(body)).not.toContain(key);
  });

  it("returns usage with a failed call so it can be priced", async () => {
    const error = new AIError("Timed out", "inference_timeout", 504);
    error.usage = {
      durationMs: 45000,
      inputTokens: 1200,
      outputTokens: 0,
      provider: "openai",
      model: "gpt-6.1-terra",
    };
    expect(await failure(error).json()).toMatchObject({
      code: "inference_timeout",
      usage: { inputTokens: 1200, model: "gpt-6.1-terra" },
    });
  });
});

describe("listing a visitor's models", () => {
  const get = (headers: Record<string, string> = withKey) =>
    listModels(
      new NextRequest("https://fieldwork.vercel.app/api/ai/models", {
        headers,
      }),
    );
  const openai = (body: unknown, status = 200) => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json(body, { status }),
    );
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  };

  it("returns the key's priced models cheapest first", async () => {
    const fetcher = openai({
      object: "list",
      data: [
        "gpt-6-astra",
        "gpt-6-luna",
        "gpt-7-preview",
        "text-embedding-3-small",
        "gpt-4o-2024-08-06",
      ].map((id) => ({ id, object: "model", created: 0, owned_by: "openai" })),
    });
    const response = await get();
    expect(await response.json()).toEqual({
      priced: ["gpt-6-luna", "gpt-6-astra"],
      unpriced: ["gpt-7-preview"],
    });
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://api.openai.com/v1/models",
    );
  });

  it.each([
    [401, "openai_key_rejected"],
    [403, "openai_models_forbidden"],
  ])("explains HTTP %i without echoing the key", async (httpStatus, code) => {
    openai({ error: { message: `Bad key ${key}` } }, httpStatus);
    const body = await (await get()).json();
    expect(body.code).toBe(code);
    expect(JSON.stringify(body)).not.toContain(key);
  });

  it("needs a key", async () => {
    const response = await get({});
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("user_key_missing");
  });

  it("refuses unpriced models on a visitor's key", () => {
    expect(() =>
      requestProvider(
        new Headers({ "x-openai-key": key, "x-openai-model": "gpt-7-preview" }),
      ),
    ).toThrow(expect.objectContaining({ code: "user_model_unpriced" }));
  });
});

describe("hints on an invite-only deployment", () => {
  it("never tell visitors to sign in when sign-up is closed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SIGNUPS", "closed");
    const body = await (
      await status(
        new NextRequest("https://fieldwork.vercel.app/api/ai/status"),
      )
    ).json();
    expect(body).toMatchObject({ allowed: false, local: false });
    expect(body.message).toContain("your own OpenAI key");
    expect(body.message).not.toContain("Sign in");
    await expect(
      inferenceAccess(hosted("/api/resume/extract")),
    ).rejects.toThrow(/^Add your own OpenAI key/);
  });

  it("mention sign-in when accounts are open", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const body = await (
      await status(
        new NextRequest("https://fieldwork.vercel.app/api/ai/status"),
      )
    ).json();
    expect(body.message).toContain("Sign in");
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ModelKey, SessionTotal } from "../../components/shell/model-key";
import { CostHint } from "../../components/ui/cost-hint";
import { apiClient, usageFrom } from "../../lib/api-client";
import {
  forgetUserKey,
  getUserKeyState,
  recordUsage,
  resetUserKeyCache,
  saveUserKey,
} from "../../lib/user-key";

const key = "sk-test_" + "b".repeat(40);
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  resetUserKeyCache();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("key storage", () => {
  it("keeps the key for this tab unless asked to remember it", () => {
    saveUserKey({ key, model: "gpt-6.1-terra" }, false);
    expect(sessionStorage.getItem("fieldwork-openai-key-v1")).toContain(key);
    expect(localStorage.getItem("fieldwork-openai-key-v1")).toBeNull();
    saveUserKey({ key, model: "gpt-6.1-terra" }, true);
    expect(sessionStorage.getItem("fieldwork-openai-key-v1")).toBeNull();
    expect(localStorage.getItem("fieldwork-openai-key-v1")).toContain(key);
    resetUserKeyCache();
    expect(getUserKeyState()).toMatchObject({ remember: true });
  });

  it("forgets the key everywhere and resets the session total", () => {
    saveUserKey({ key, model: "gpt-6.1-terra" }, true);
    recordUsage({ inputTokens: 5, outputTokens: 5 });
    forgetUserKey();
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect(getUserKeyState()).toMatchObject({
      userKey: null,
      usage: { calls: 0 },
    });
  });

  it("still works when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    saveUserKey({ key, model: "gpt-6.1-terra" }, false);
    expect(getUserKeyState().userKey?.key).toBe(key);
    vi.restoreAllMocks();
  });
});

describe("API client", () => {
  const respond = (body: unknown, status = 200) =>
    vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json(body, { status }),
    );

  it("sends the key and model only when one is set", async () => {
    const fetcher = respond({});
    vi.stubGlobal("fetch", fetcher);
    const request = apiClient(() => "");
    await request("/api/ai/status");
    expect(fetcher.mock.calls[0][1]!.headers).not.toHaveProperty(
      "x-openai-key",
    );
    saveUserKey({ key, model: "gpt-6-luna" }, false);
    await request("/api/ai/status");
    expect(fetcher.mock.calls[1][1]!.headers).toMatchObject({
      "x-openai-key": key,
      "x-openai-model": "gpt-6-luna",
    });
  });

  it("adds successful and failed calls to the session total", async () => {
    vi.stubGlobal(
      "fetch",
      respond({
        metadata: {
          provider: "openai",
          model: "gpt-6.1-terra",
          inputTokens: 1000,
          outputTokens: 200,
        },
      }),
    );
    await apiClient(() => "")("/api/jobs/extract", { body: {} });
    vi.stubGlobal(
      "fetch",
      respond(
        {
          error: "Timed out",
          usage: {
            provider: "openai",
            model: "gpt-6.1-terra",
            inputTokens: 500,
            outputTokens: 0,
          },
        },
        504,
      ),
    );
    await expect(
      apiClient(() => "")("/api/jobs/extract", { body: {} }),
    ).rejects.toThrow("Timed out");
    expect(getUserKeyState().usage).toMatchObject({
      calls: 2,
      inputTokens: 1500,
      outputTokens: 200,
    });
  });

  it("reads usage in every response shape", () => {
    expect(usageFrom({ inputTokens: 1, outputTokens: 2, model: "m" })).toEqual({
      provider: undefined,
      model: "m",
      inputTokens: 1,
      outputTokens: 2,
    });
    expect(usageFrom({ ok: true })).toBeNull();
  });
});

describe("model key panel", () => {
  it("saves a key, shows only its last four characters, and forgets it", () => {
    render(<ModelKey />);
    fireEvent.click(
      screen.getByRole("button", { name: "Use your own OpenAI key" }),
    );
    fireEvent.change(screen.getByLabelText("OpenAI API key"), {
      target: { value: key },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this key" }));
    expect(screen.getByText(/is in use/).textContent).toContain(
      `…${key.slice(-4)}`,
    );
    expect(document.body.textContent).not.toContain(key);
    fireEvent.click(screen.getByRole("button", { name: "Forget key" }));
    expect(screen.getByRole("button", { name: "Use your own OpenAI key" }));
  });

  it("recommends a limited, revocable key", () => {
    render(<ModelKey />);
    fireEvent.click(
      screen.getByRole("button", { name: "Use your own OpenAI key" }),
    );
    expect(document.body.textContent).toContain("monthly budget");
    expect(
      screen
        .getByRole("link", { name: "OpenAI API keys" })
        .getAttribute("href"),
    ).toBe("https://platform.openai.com/api-keys");
  });

  it("rejects something that isn't a key", () => {
    render(<ModelKey />);
    fireEvent.click(
      screen.getByRole("button", { name: "Use your own OpenAI key" }),
    );
    fireEvent.change(screen.getByLabelText("OpenAI API key"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this key" }));
    expect(screen.getByRole("alert").textContent).toContain("sk-");
    expect(getUserKeyState().userKey).toBeNull();
  });

  it("shows the session total once a call was made", () => {
    const { rerender } = render(
      <SessionTotal usage={getUserKeyState().usage} />,
    );
    expect(document.body.textContent).toBe("");
    act(() =>
      recordUsage({
        provider: "openai",
        model: "gpt-6.1-terra",
        inputTokens: 1000,
        outputTokens: 1000,
      }),
    );
    rerender(<SessionTotal usage={getUserKeyState().usage} />);
    expect(document.body.textContent).toContain("1 call");
    expect(document.body.textContent).toContain("≈ $0.006");
  });
});

describe("cost hint", () => {
  const openai = {
    provider: "openai" as const,
    model: "gpt-6.1-terra",
    ready: true,
    message: "",
    source: "user" as const,
  };
  it("shows the most a step can cost on the visitor's key", () => {
    render(<CostHint ai={openai} step="job" sourceChars={4000} />);
    // (800 + 1,000) in at $1 + 5,500 out at $5, per 1M tokens.
    expect(document.body.textContent).toBe(
      "Uses your OpenAI key · gpt-6.1-terra · at most ≈ $0.029",
    );
  });
  it("falls back to tokens for an unpriced model", () => {
    render(
      <CostHint
        ai={{ ...openai, model: "new-model" }}
        step="job"
        sourceChars={4000}
      />,
    );
    expect(document.body.textContent).toContain("1,800 in / 5,500 out tokens");
  });
  it("says local models cost nothing and stays hidden when not ready", () => {
    const { rerender } = render(
      <CostHint
        ai={{ ...openai, provider: "ollama", model: "qwen3:8b" }}
        step="resume"
        sourceChars={10}
      />,
    );
    expect(document.body.textContent).toContain("no API cost");
    rerender(
      <CostHint
        ai={{ ...openai, ready: false }}
        step="resume"
        sourceChars={10}
      />,
    );
    expect(document.body.textContent).toBe("");
  });
});

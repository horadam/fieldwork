import { afterEach, it, expect, vi } from "vitest";
import {
  transcribePractice,
  AUDIO_MODEL,
  MAX_AUDIO_BYTES,
} from "../lib/practice-audio";
const input = {
  consent: true,
  mime: "audio/webm",
  audio: Buffer.from("synthetic audio fixture").toString("base64"),
};
const openai = {
  provider: "openai" as const,
  model: "test",
  deadlineMs: 45000,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("never falls back from local inference to billed transcription", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    transcribePractice(input, { ...openai, provider: "ollama" }),
  ).rejects.toMatchObject({ code: "voice_provider" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("requires explicit consent, valid format and bounded audio", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  for (const value of [
    { ...input, consent: false },
    { ...input, mime: "text/html" },
    { ...input, audio: "x".repeat(7000000) },
    // Just over the 3 MB limit that keeps uploads under Vercel's body cap.
    { ...input, audio: Buffer.alloc(MAX_AUDIO_BYTES + 3).toString("base64") },
  ])
    await expect(transcribePractice(value, openai)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it("transcribes once and reports separate audio usage", async () => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  const fetcher = vi.fn(async () =>
    Response.json({
      text: "I built a form.",
      usage: {
        type: "tokens",
        input_tokens: 24,
        output_tokens: 6,
        total_tokens: 30,
      },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await transcribePractice(input, openai);
  expect(result.text).toBe("I built a form.");
  expect(result.metadata).toMatchObject({
    model: AUDIO_MODEL,
    inputTokens: 24,
    outputTokens: 6,
  });
  expect(
    (fetcher.mock.calls as unknown as [string][]).filter(([url]) =>
      String(url).startsWith("https://api.openai.com/"),
    ),
  ).toHaveLength(1);
});
it("sanitizes provider errors and does not retry", async () => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  const fetcher = vi.fn(async () =>
    Response.json(
      { error: { message: "PRIVATE_AUDIO_AND_KEY" } },
      { status: 500 },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(transcribePractice(input, openai)).rejects.not.toThrow(
    "PRIVATE_AUDIO_AND_KEY",
  );
  expect(
    (fetcher.mock.calls as unknown as [string][]).filter(([url]) =>
      String(url).startsWith("https://api.openai.com/"),
    ),
  ).toHaveLength(1);
});
it("names the audio model and OpenAI's error code when a recording is rejected", async () => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        {
          error: {
            message: "PRIVATE_AUDIO_AND_KEY",
            code: "invalid_value",
            type: "invalid_request_error",
          },
        },
        { status: 400 },
      ),
    ),
  );
  const error = await transcribePractice(input, openai).catch((e) => e);
  expect(error).toMatchObject({ code: "openai_request_rejected", status: 400 });
  expect(error.message).toContain(AUDIO_MODEL);
  expect(error.message).toContain("400 invalid_value");
  expect(error.message).not.toContain("PRIVATE_AUDIO_AND_KEY");
});

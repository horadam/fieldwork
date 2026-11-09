import { z } from "zod";
import { toFile } from "openai";
import {
  AIError,
  openAIClient,
  providerError,
  type Provider,
} from "./ai-provider";
export const AUDIO_MODEL = "gpt-4o-mini-transcribe";
const TRANSCRIBE_DEADLINE_MS = 45000;
import { MAX_AUDIO_BYTES } from "./practice-audio-limits";
export { MAX_AUDIO_BYTES };
const extensions = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
} as const;
export const audioInput = z.object({
  consent: z.literal(true),
  mime: z.enum(["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"]),
  audio: z
    .string()
    .min(4)
    .max(Math.ceil(MAX_AUDIO_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export async function transcribePractice(
  raw: unknown,
  config: Provider,
  signal?: AbortSignal,
) {
  if (config.provider !== "openai")
    throw new AIError(
      "Voice transcription requires explicitly selecting OpenAI. Ollama text practice remains available; no fallback was made.",
      "voice_provider",
      400,
    );
  const input = audioInput.parse(raw),
    bytes = Buffer.from(input.audio, "base64");
  if (
    !bytes.length ||
    bytes.length > MAX_AUDIO_BYTES ||
    bytes.toString("base64") !== input.audio
  )
    throw new AIError("Use a valid recording up to 3 MB.", "voice_input", 400);
  const started = Date.now(),
    deadline = AbortSignal.timeout(TRANSCRIBE_DEADLINE_MS);
  let inputTokens = 0,
    outputTokens = 0;
  try {
    const response = await openAIClient(config).audio.transcriptions.create(
      {
        file: await toFile(bytes, `answer.${extensions[input.mime]}`, {
          type: input.mime,
        }),
        model: AUDIO_MODEL,
        response_format: "json",
      },
      {
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        maxRetries: 0,
      },
    );
    inputTokens =
      response.usage?.type === "tokens" ? response.usage.input_tokens : 0;
    outputTokens =
      response.usage?.type === "tokens" ? response.usage.output_tokens : 0;
    const text = z.string().trim().min(1).max(6000).safeParse(response.text);
    if (!text.success)
      throw new AIError(
        "The transcript is empty or longer than 6,000 characters. Try a shorter recording or type your answer.",
        "voice_output",
        422,
      );
    return {
      text: text.data,
      metadata: {
        provider: "openai" as const,
        model: AUDIO_MODEL,
        promptVersion: "transcription-v1",
        durationMs: Date.now() - started,
        inputTokens:
          response.usage?.type === "tokens" ? response.usage.input_tokens : 0,
        outputTokens:
          response.usage?.type === "tokens" ? response.usage.output_tokens : 0,
      },
    };
  } catch (e) {
    // Our own deadline reaches the SDK as an abort, so name it here.
    const error = deadline.aborted
      ? new AIError(
          `OpenAI did not finish transcribing within ${TRANSCRIBE_DEADLINE_MS / 1000} seconds. Your recording is retained; retry, or record a shorter answer. No automatic retry was made.`,
          "inference_timeout",
          504,
        )
      : signal?.aborted
        ? new AIError(
            "Transcription was cancelled. Your recording is retained.",
            "inference_cancelled",
            499,
          )
        : providerError(config, e, AUDIO_MODEL);
    error.usage = {
      provider: "openai",
      model: AUDIO_MODEL,
      durationMs: Date.now() - started,
      inputTokens,
      outputTokens,
    };
    throw error;
  }
}

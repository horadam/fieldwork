import OpenAI from "openai";
import {
  OpenAIChatCompletionsModel,
  OpenAIResponsesModel,
} from "@openai/agents";

export type Provider = {
  provider: "ollama" | "openai";
  model: string;
  deadlineMs: number;
};
export const OLLAMA_URL = "http://127.0.0.1:11434";
export class AIError extends Error {
  constructor(
    message: string,
    public code = "ai_configuration",
    public status = 502,
  ) {
    super(message);
  }
}
export function providerConfig(): Provider {
  const provider = process.env.AI_PROVIDER || "ollama";
  if (provider !== "ollama" && provider !== "openai")
    throw new AIError("Set AI_PROVIDER to ollama or openai.");
  const model =
    provider === "ollama"
      ? process.env.OLLAMA_MODEL || "qwen3:8b"
      : process.env.OPENAI_MODEL || "";
  if (!model || model.length > 100)
    throw new AIError(
      "Set a valid server model name (OPENAI_MODEL or OLLAMA_MODEL).",
    );
  // Ollama can route cloud models through localhost. Only installed local models are allowed.
  if (provider === "ollama" && /cloud|https?:|\//i.test(model))
    throw new AIError(
      "OLLAMA_MODEL must name a local model, such as qwen3:8b.",
    );
  return {
    provider,
    model,
    deadlineMs: provider === "ollama" ? 180000 : 45000,
  };
}
export function openAIClient(config: Provider) {
  if (config.provider === "openai" && !process.env.OPENAI_API_KEY)
    throw new AIError("Set OPENAI_API_KEY on the server, or select Ollama.");
  return new OpenAI({
    apiKey:
      config.provider === "ollama" ? "local-only" : process.env.OPENAI_API_KEY,
    baseURL:
      config.provider === "ollama"
        ? `${OLLAMA_URL}/v1`
        : "https://api.openai.com/v1",
    maxRetries: 0,
    timeout: config.deadlineMs,
  });
}
export function agentModel(config: Provider) {
  const client = openAIClient(config);
  return config.provider === "ollama"
    ? new OpenAIChatCompletionsModel(client, config.model)
    : new OpenAIResponsesModel(client, config.model);
}
export function providerError(config: Provider, error: unknown): AIError {
  if (error instanceof AIError) return error;
  const diagnostic =
    error && typeof error === "object"
      ? (error as { name?: string; cause?: { code?: string } })
      : {};
  if (config.provider === "ollama") {
    const suffix = " No OpenAI request or fallback was made.";
    if (
      diagnostic.name === "TimeoutError" ||
      diagnostic.name === "APIConnectionTimeoutError"
    ) {
      return new AIError(
        `Local inference exceeded ${Math.round(config.deadlineMs / 1000)} seconds. Try a shorter source or retry after the model has loaded.${suffix}`,
        "inference_timeout",
        504,
      );
    }
    if (
      ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH"].includes(
        diagnostic.cause?.code || "",
      )
    ) {
      return new AIError(
        `The application server could not connect to Ollama at ${OLLAMA_URL}. Open Ollama, then refresh model status.${suffix}`,
        "ollama_unreachable",
        503,
      );
    }
    if (["EPERM", "EACCES"].includes(diagnostic.cause?.code || "")) {
      return new AIError(
        `The application server is not permitted to connect to local Ollama. Run the development server from your terminal and check its network permissions.${suffix}`,
        "ollama_connection_denied",
        503,
      );
    }
  }
  return new AIError(
    config.provider === "ollama"
      ? `Local inference failed, timed out, or returned invalid output. Open Ollama, ensure ${config.model} is installed, and retry. No OpenAI request or fallback was made.`
      : "OpenAI inference failed, timed out, or returned invalid output. Check the server model, API key, and account limits before retrying. No automatic retry was made.",
    "inference_failed",
  );
}
export async function providerStatus(config: Provider) {
  if (config.provider === "openai")
    return {
      ...config,
      ready: !!process.env.OPENAI_API_KEY,
      message: process.env.OPENAI_API_KEY
        ? "Server key configured; connectivity and account access are checked on execution."
        : "Set OPENAI_API_KEY on the server.",
    };
  try {
    const response = await fetch(`${OLLAMA_URL}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model }),
      signal: AbortSignal.timeout(2500),
      redirect: "error",
    });
    if (!response.ok) throw new Error();
    const info = await response.json();
    if (info.remote_host || info.remote_model)
      throw new AIError(
        "Cloud-routed Ollama models are disabled. Choose an installed local model.",
      );
    return {
      ...config,
      ready: true,
      message:
        "Installed local model is available. Quality and latency require evaluation.",
    };
  } catch (error) {
    return {
      ...config,
      ready: false,
      message:
        error instanceof AIError
          ? error.message
          : `Open Ollama and install ${config.model} separately (ollama pull ${config.model}).`,
    };
  }
}

import OpenAI from "openai";
import { DEFAULT_USER_MODEL, modelPrice, PRICED_MODELS } from "./pricing";
import { USER_KEY_HEADER, USER_MODEL_HEADER } from "./user-key";
import {
  OpenAIChatCompletionsModel,
  OpenAIResponsesModel,
} from "@openai/agents";

export type Provider = {
  provider: "ollama" | "openai";
  model: string;
  deadlineMs: number;
  // A visitor's own OpenAI key, for this request only. Non-enumerable, so it
  // never ends up in a response, log or stored record built from the config.
  readonly apiKey?: string;
};
export const OLLAMA_URL = "http://127.0.0.1:11434";
export type CallUsage = {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  // Set on failures, so the browser can price a call that did not finish.
  provider?: Provider["provider"];
  model?: string;
};
export class AIError extends Error {
  // Set on failures after a model call started, so callers can record cost.
  usage?: CallUsage;
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
const userKeyPattern = /^sk-[A-Za-z0-9_-]{20,300}$/;
const userModelPattern = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;

export const hasUserKey = (headers: Headers) => headers.has(USER_KEY_HEADER);

// The visitor's key and model when supplied, otherwise the server's provider.
export function requestProvider(headers: Headers): Provider {
  const key = headers.get(USER_KEY_HEADER);
  if (key === null) return providerConfig();
  const model = headers.get(USER_MODEL_HEADER) || DEFAULT_USER_MODEL;
  if (!userKeyPattern.test(key))
    throw new AIError(
      "That doesn't look like an OpenAI API key. Check it in the model panel.",
      "user_key_invalid",
      400,
    );
  if (!userModelPattern.test(model))
    throw new AIError(
      "Enter an OpenAI model name, such as gpt-6.1-terra.",
      "user_model_invalid",
      400,
    );
  // A visitor's key may only run models whose cost the app can show.
  if (!modelPrice("openai", model))
    throw new AIError(
      `${model} isn't in this app's price list, so its cost can't be shown. Choose a listed model in the model panel.`,
      "user_model_unpriced",
      400,
    );
  const config: Provider = { provider: "openai", model, deadlineMs: 45000 };
  Object.defineProperty(config, "apiKey", { value: key, enumerable: false });
  return config;
}

/**
 * The priced models a visitor's key can use, cheapest first, plus the chat
 * models it has that the price list doesn't cover yet. Listing models is
 * free, so this also checks the key before any billed call.
 */
export async function availableModels(config: Provider, signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(10000);
  let ids: string[];
  try {
    const page = await openAIClient(config).models.list({
      signal: signal ? AbortSignal.any([deadline, signal]) : deadline,
      maxRetries: 0,
    });
    ids = page.data.map((m) => m.id);
  } catch (error) {
    // Restricted project keys may lack the Models permission.
    if ((error as { status?: number } | null)?.status === 403)
      throw new AIError(
        "This key can't list models. In OpenAI's key settings, give it read access to Models, or use a key with all permissions.",
        "openai_models_forbidden",
        400,
      );
    throw providerError(config, error);
  }
  const available = new Set(ids);
  const priced = PRICED_MODELS.filter((m) => available.has(m)).sort((a, b) => {
    const pa = modelPrice("openai", a)!,
      pb = modelPrice("openai", b)!;
    return pa.output - pb.output || pa.input - pb.input;
  });
  const unpriced = ids
    .filter((id) => /^(gpt-|o\d)/.test(id) && !modelPrice("openai", id))
    .sort()
    .slice(0, 10);
  return { priced, unpriced };
}

export function openAIClient(config: Provider) {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (config.provider === "openai" && !apiKey)
    throw new AIError("Set OPENAI_API_KEY on the server, or select Ollama.");
  return new OpenAI({
    apiKey: config.provider === "ollama" ? "local-only" : apiKey,
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
export function providerError(
  config: Provider,
  error: unknown,
  // Calls that don't use the chat model (transcription) name their own.
  model = config.model,
): AIError {
  if (error instanceof AIError) return error;
  const diagnostic =
    error && typeof error === "object"
      ? (error as { name?: string; cause?: { code?: string } })
      : {};
  // The SDK's errors are all named "Error", so match their classes; plain
  // objects with a name cover fetch-level failures and tests.
  const timedOut =
    error instanceof OpenAI.APIConnectionTimeoutError ||
    diagnostic.name === "TimeoutError" ||
    diagnostic.name === "APIConnectionTimeoutError";
  const unreachable =
    !timedOut &&
    (error instanceof OpenAI.APIConnectionError ||
      diagnostic.name === "APIConnectionError");
  // Short identifiers only (e.g. ECONNRESET), never a message.
  const causeCode =
    typeof diagnostic.cause?.code === "string" &&
    /^[A-Z0-9_]{1,40}$/.test(diagnostic.cause.code)
      ? diagnostic.cause.code
      : undefined;
  if (config.provider === "ollama") {
    const suffix = " No OpenAI request or fallback was made.";
    if (timedOut) {
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
  if (config.provider === "openai") {
    // OpenAI's own error text is never forwarded: it can quote the key.
    const status = (error as { status?: number } | null)?.status;
    const whose = config.apiKey ? "your" : "the server's";
    // Short identifiers only (e.g. 400 invalid_value), never the message.
    const rawCode = (error as { code?: unknown } | null)?.code;
    const openaiCode =
      typeof rawCode === "string" && /^[a-z0-9_]{1,64}$/.test(rawCode)
        ? rawCode
        : undefined;
    const reference = `OpenAI ${status ?? ""}${openaiCode ? ` ${openaiCode}` : ""}`;
    if (status === 401)
      return new AIError(
        `OpenAI rejected ${whose} API key. Check the key, then retry. No automatic retry was made.`,
        "openai_key_rejected",
        400,
      );
    if (status === 429)
      return new AIError(
        `OpenAI refused the request for ${whose} key: rate limit or no remaining credit. Check the account's limits and billing, then retry. No automatic retry was made.`,
        "openai_rate_limited",
        429,
      );
    if (status === 404 || status === 403)
      return new AIError(
        `${whose === "your" ? "Your" : "The server's"} OpenAI key can't use ${model}. Check the model name, then retry. No automatic retry was made.`,
        "openai_model_unavailable",
        400,
      );
    if (status === 400 || status === 413 || status === 422)
      return new AIError(
        `OpenAI rejected the request for ${model} (${reference}). Check the input, then retry. No automatic retry was made.`,
        "openai_request_rejected",
        400,
      );
    if (status && status >= 500)
      return new AIError(
        `OpenAI returned a server error for ${model} (${reference}). Wait a moment, then retry. No automatic retry was made.`,
        "openai_server_error",
        502,
      );
    if (timedOut)
      return new AIError(
        `OpenAI did not answer within ${Math.round(config.deadlineMs / 1000)} seconds. Retry, or try a shorter input. No automatic retry was made.`,
        "inference_timeout",
        504,
      );
    if (error instanceof OpenAI.APIUserAbortError)
      return new AIError(
        "The OpenAI request was cancelled before it finished. No automatic retry was made.",
        "inference_cancelled",
        499,
      );
    if (unreachable)
      return new AIError(
        `The application server lost its connection to OpenAI${causeCode ? ` (${causeCode})` : ""}. Check its network connection, then retry. No automatic retry was made.`,
        "openai_unreachable",
        503,
      );
  }
  return new AIError(
    config.provider === "ollama"
      ? `Local inference failed, timed out, or returned invalid output. Open Ollama, ensure ${config.model} is installed, and retry. No OpenAI request or fallback was made.`
      : `OpenAI inference failed${errorKind(error)}. Check the server model, API key, and account limits before retrying. No automatic retry was made.`,
    "inference_failed",
  );
}
// The error's class, e.g. " (TypeError)", so an unmapped failure can be traced
// without forwarding its message.
function errorKind(error: unknown) {
  const name =
    error && typeof error === "object" ? error.constructor?.name : undefined;
  return name && name !== "Object" && /^[A-Za-z]{1,40}$/.test(name)
    ? ` (${name})`
    : "";
}
export async function providerStatus(config: Provider) {
  // Making a test call would spend the visitor's money, so none is made.
  if (config.apiKey)
    return {
      ...config,
      source: "user" as const,
      ready: true,
      message:
        "Using your OpenAI key. The key and model are checked when a request runs.",
    };
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

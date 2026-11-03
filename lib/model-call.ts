import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  AIError,
  OLLAMA_URL,
  openAIClient,
  providerError,
  type CallUsage,
  type Provider,
} from "./ai-provider";

export type CallMetadata = CallUsage & {
  provider: Provider["provider"];
  model: string;
  promptVersion: string;
};

// Flow-specific wording; every other message is shared so all flows fail alike.
export type CallCopy = {
  // Lower-case noun phrase, e.g. "job extraction".
  task: string;
  // What the user still has, e.g. "Your source text is retained."
  kept: string;
  // How to recover from an output-limit or timeout failure.
  shorten: string;
};

const ollamaEnvelope = z.object({
  // Optional so a truncated reply is reported as truncation, not as malformed.
  message: z.object({ content: z.string() }).optional(),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
  prompt_eval_count: z.number().nonnegative().optional(),
  eval_count: z.number().nonnegative().optional(),
});

/**
 * One structured, single-attempt model call: explicit deadline, no retries or
 * provider fallback, sanitized errors, and duration and token usage recorded
 * on success and failure alike. Output is untrusted until `validate` accepts it.
 */
export async function structuredCompletion<T>(options: {
  config: Provider;
  // Error-code prefix, e.g. "job" gives job_invalid_json.
  flow: string;
  copy: CallCopy;
  schema: z.ZodType;
  schemaName: string;
  system: string;
  // Receives the JSON schema for prompts that restate it to the model.
  user: string | ((jsonSchema: unknown) => string);
  maxTokens: number;
  promptVersion: string;
  // Throws to reject output; an AIError keeps its own message and code.
  validate: (raw: unknown) => T;
  signal?: AbortSignal;
}): Promise<{ output: T; metadata: CallMetadata }> {
  const { config, flow, copy, signal } = options;
  const suffix =
    config.provider === "ollama"
      ? " No OpenAI request or fallback was made."
      : " No automatic retry was made.";
  const started = Date.now(),
    deadline = AbortSignal.timeout(config.deadlineMs),
    combined = signal ? AbortSignal.any([deadline, signal]) : deadline;
  const usage: CallUsage = { durationMs: 0, inputTokens: 0, outputTokens: 0 };
  const fail = (message: string, code: string, status = 502): never => {
    throw new AIError(`${message} ${copy.kept}${suffix}`, code, status);
  };
  const jsonSchema = z.toJSONSchema(options.schema);
  const messages = [
    { role: "system" as const, content: options.system },
    {
      role: "user" as const,
      content:
        typeof options.user === "string"
          ? options.user
          : options.user(jsonSchema),
    },
  ];
  try {
    let content: string;
    if (config.provider === "ollama") {
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: false,
          think: false,
          format: jsonSchema,
          options: {
            temperature: 0,
            num_ctx: 32768,
            num_predict: options.maxTokens,
          },
        }),
        signal: combined,
        redirect: "error",
      });
      // Never expose provider error bodies: they may echo private source text.
      if (response.status === 404)
        fail(
          `Ollama could not find ${config.model}. Install it separately with ollama pull ${config.model}, then retry.`,
          "ollama_model_missing",
          503,
        );
      if (response.status === 400)
        fail(
          "Ollama rejected the structured request (HTTP 400). Check that your Ollama version and model support structured outputs.",
          "ollama_request_rejected",
        );
      if (response.status === 429 || response.status === 503)
        fail(
          `Ollama is busy or unavailable (HTTP ${response.status}). Let the current run finish, then retry.`,
          "ollama_busy",
          503,
        );
      if (!response.ok)
        fail(
          `Ollama returned HTTP ${response.status}. Check its local server log for model loading or memory errors, then retry.`,
          "ollama_server_error",
        );
      let envelope: unknown;
      try {
        envelope = await response.json();
      } catch {
        fail(
          "Ollama returned an unreadable response. Check the local Ollama service and retry.",
          "invalid_provider_response",
        );
      }
      const parsed = ollamaEnvelope.safeParse(envelope);
      if (!parsed.success)
        return fail(
          "Ollama responded without the expected message content. Check the selected local model and Ollama version.",
          "invalid_provider_response",
        );
      usage.inputTokens = parsed.data.prompt_eval_count || 0;
      usage.outputTokens = parsed.data.eval_count || 0;
      if (parsed.data.done_reason === "length" || parsed.data.done === false)
        fail(
          `The model reached its output limit before finishing the ${copy.task}. ${copy.shorten}`,
          `${flow}_truncated`,
        );
      if (!parsed.data.message)
        return fail(
          "Ollama responded without the expected message content. Check the selected local model and Ollama version.",
          "invalid_provider_response",
        );
      content = parsed.data.message.content;
    } else {
      const result = await openAIClient(config).chat.completions.create(
        {
          model: config.model,
          messages,
          response_format: zodResponseFormat(
            options.schema,
            options.schemaName,
          ),
          max_completion_tokens: options.maxTokens,
        },
        { signal: combined, maxRetries: 0 },
      );
      usage.inputTokens = result.usage?.prompt_tokens || 0;
      usage.outputTokens = result.usage?.completion_tokens || 0;
      const choice = result.choices[0];
      if (choice?.finish_reason === "length")
        fail(
          `The model reached its output limit before finishing the ${copy.task}. ${copy.shorten}`,
          `${flow}_truncated`,
        );
      if (
        !choice ||
        choice.finish_reason !== "stop" ||
        choice.message.refusal ||
        !choice.message.content
      )
        return fail(
          `OpenAI did not return a complete ${copy.task}. Check the configured model and retry explicitly.`,
          `${flow}_incomplete`,
        );
      content = choice.message.content;
    }
    if (!content.trim())
      fail(
        `The model returned no output for the ${copy.task}. Check the model, then retry.`,
        `${flow}_empty_output`,
      );
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      fail(
        `The model returned invalid JSON for the ${copy.task}. Retry explicitly.`,
        `${flow}_invalid_json`,
      );
    }
    let output: T;
    try {
      output = options.validate(raw);
    } catch (error) {
      if (error instanceof AIError)
        throw new AIError(error.message + suffix, error.code, error.status);
      return fail(
        `The model returned invalid fields or references for the ${copy.task}. Retry explicitly.`,
        `${flow}_invalid_output`,
      );
    }
    usage.durationMs = Date.now() - started;
    return {
      output,
      metadata: {
        provider: config.provider,
        model: config.model,
        promptVersion: options.promptVersion,
        ...usage,
      },
    };
  } catch (error) {
    usage.durationMs = Date.now() - started;
    let failure: AIError;
    if (deadline.aborted)
      failure = new AIError(
        `${config.provider === "ollama" ? "Local" : "OpenAI"} ${copy.task} timed out after ${Math.round(config.deadlineMs / 1000)} seconds. ${copy.shorten} ${copy.kept}${suffix}`,
        "inference_timeout",
        504,
      );
    else if (signal?.aborted)
      failure = new AIError(
        `The ${copy.task} was cancelled. ${copy.kept}${suffix}`,
        "inference_cancelled",
        499,
      );
    else failure = providerError(config, error);
    failure.usage = {
      ...usage,
      provider: config.provider,
      model: config.model,
    };
    throw failure;
  }
}

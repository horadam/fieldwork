import { z } from "zod";

// Coach feedback and call metadata, shared by mock-interview turns and notes
// reviews. Kept apart from both so neither module imports the other.
const text = z.string().trim().min(1);
export const feedbackSchema = z.object({
  strength: text.max(1000),
  improvement: text.max(1000),
  caution: z.string().max(1000),
  // An exact short substring of the reviewed text, or empty.
  answerQuote: z.string().max(800),
});
export type Feedback = z.infer<typeof feedbackSchema>;
export const callMetadataSchema = z.object({
  provider: z.enum(["ollama", "openai"]),
  model: text.max(100),
  promptVersion: text.max(100),
  durationMs: z.number().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
});

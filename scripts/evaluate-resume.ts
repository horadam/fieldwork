import { extractResume } from "../lib/resume-extraction";
import { resumeCases } from "../evals/resume-cases";
import { scoreResume } from "../evals/score";
import { runEval } from "./eval-harness";

await runEval("resume", resumeCases, async (c, config) => {
  const { output, metadata } = await extractResume(
    { text: c.text, pages: [] },
    config,
  );
  return {
    output,
    metadata,
    score: scoreResume(c.expected, c.forbidden, output.drafts),
  };
});

import { extractJob } from "../lib/job-extraction";
import { jobCases } from "../evals/job-cases";
import { scoreJob } from "../evals/score";
import { runEval } from "./eval-harness";

await runEval("job", jobCases, async (c, config) => {
  const { output, metadata } = await extractJob(c.text, config);
  return {
    output,
    metadata,
    score: scoreJob(c.expected, c.mustInclude, c.forbidden, output),
  };
});

import { mkdir, writeFile } from "node:fs/promises";
import { analyze } from "../lib/agent";
import { providerConfig } from "../lib/ai-provider";
import { cases } from "../evals/cases";

if (
  process.env.AI_PROVIDER !== "openai" ||
  !process.argv.includes("--allow-paid") ||
  !process.env.OPENAI_API_KEY ||
  !process.env.OPENAI_MODEL
) {
  throw new Error(
    "Select AI_PROVIDER=openai and set OPENAI_API_KEY and OPENAI_MODEL. This command performs paid model calls. Add --allow-paid to opt in.",
  );
}
const results = [];
// Sequential calls bound concurrency/cost. Two variants × 20 cases; retry manually after inspecting failures.
for (const variant of ["baseline", "grounded"] as const)
  for (const c of cases) {
    try {
      const run = await analyze(
        c.jd,
        c.evidence,
        process.env.OPENAI_MODEL,
        variant,
        providerConfig(),
      );
      const exactStatusMatch =
        run.output.requirements.length === 1 &&
        run.output.requirements[0].status === c.expected;
      results.push({
        caseId: c.id,
        topic: c.topic,
        variant,
        expected: c.expected,
        exactStatusMatch,
        ...run,
        reviewRubric: c.review,
        manualGroundingReview: null,
        manualRelevanceReview: null,
      });
    } catch {
      results.push({
        caseId: c.id,
        variant,
        error: "Run failed or violated output contract",
        manualGroundingReview: null,
        manualRelevanceReview: null,
      });
    }
  }
await mkdir("evals/results", { recursive: true });
const path = `evals/results/${new Date().toISOString().replaceAll(":", "-")}.json`;
await writeFile(
  path,
  JSON.stringify(
    {
      model: process.env.OPENAI_MODEL,
      createdAt: new Date().toISOString(),
      note: "Status agreement is a heuristic. Human review is required for coverage, grounding, relevance, and split requirements.",
      results,
    },
    null,
    2,
  ),
);
console.log(
  `Saved ${results.length} runs to ${path}. Complete manual review before claiming an improvement.`,
);

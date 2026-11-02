import { generatePreparation } from "../lib/preparation-generation";
import { planSources } from "../lib/preparation-plan";
import { preparationCases } from "../evals/preparation-cases";
import { scorePreparation } from "../evals/score";
import { runEval } from "./eval-harness";

await runEval("preparation", preparationCases, async (c, config) => {
  const sources = await planSources(c.target, c.workspace);
  const { output, metadata } = await generatePreparation(
    sources,
    c.target.settings,
    config,
  );
  return {
    output,
    metadata,
    score: scorePreparation(output, sources, c.target.settings),
  };
});

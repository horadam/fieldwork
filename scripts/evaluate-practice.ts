import { readFile, mkdir, writeFile } from "node:fs/promises";
import { providerConfig } from "../lib/ai-provider";
import { practiceTurn } from "../lib/practice-generation";
import { newSession } from "../lib/practice-session";
import { planSources } from "../lib/preparation-plan";
import { target, workspace, version } from "../tests/preparation-fixtures";
const config = providerConfig();
if (config.provider !== "ollama" && !process.argv.includes("--allow-paid"))
  throw new Error("Paid evaluation requires --allow-paid.");
const cases = JSON.parse(
  await readFile(
    new URL("../evals/practice/cases.json", import.meta.url),
    "utf8",
  ),
);
const plan = version(await planSources(target, workspace()));
const results = [];
for (const c of cases) {
  try {
    const result = await practiceTurn(
      plan,
      newSession(plan, ["q1"], "coach"),
      c.answer,
      config,
    );
    results.push({
      id: c.id,
      review: c.review,
      followUpExpected: c.expectFollowUp,
      followUpObserved: result.session.status === "active",
      ...result,
    });
  } catch (e) {
    results.push({
      id: c.id,
      error: e instanceof Error ? e.message : "Failed",
    });
  }
}
await mkdir("evals/results", { recursive: true });
await writeFile(
  `evals/results/practice-${Date.now()}.json`,
  JSON.stringify(results, null, 2),
);
process.stdout.write(
  JSON.stringify(
    results.map((r) => ({
      id: r.id,
      error: r.error,
      followUp: "followUpObserved" in r ? r.followUpObserved : undefined,
      metadata: "metadata" in r ? r.metadata : undefined,
    })),
    null,
    2,
  ) + "\n",
);

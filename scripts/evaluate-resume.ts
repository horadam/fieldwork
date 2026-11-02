import { mkdir, writeFile } from "node:fs/promises";
import { providerConfig } from "../lib/ai-provider";
import { extractResume } from "../lib/resume-extraction";
import { resumeCases } from "../evals/resume-cases";
const config = providerConfig();
if (config.provider === "openai" && !process.argv.includes("--allow-paid"))
  throw new Error(
    "Paid comparisons are opt-in: add --allow-paid after selecting OpenAI in server configuration.",
  );
const results = [];
const norm = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();
for (const c of resumeCases) {
  const started = Date.now();
  try {
    const result = await extractResume({ text: c.text, pages: [] }, config);
    const remaining = [...result.drafts];
    let correctFields = 0;
    for (const expected of c.expected) {
      const i = remaining.findIndex(
        (d) =>
          norm(d.organization) === norm(expected.organization) &&
          norm(d.role) === norm(expected.role),
      );
      if (i >= 0) {
        const [actual] = remaining.splice(i, 1);
        correctFields +=
          2 + (norm(actual.dates) === norm(expected.dates) ? 1 : 0);
      }
    }
    const generated = result.drafts
      .map((d) =>
        [d.organization, d.role, d.dates, ...d.accomplishments].join("\n"),
      )
      .join("\n");
    const inventedClaimFlags = c.forbidden.filter((claim) =>
      norm(generated).includes(norm(claim)),
    );
    results.push({
      id: c.id,
      expectedCount: c.expected.length,
      actualCount: result.drafts.length,
      correctFields,
      totalExpectedFields: c.expected.length * 3,
      exactCountMatch: c.expected.length === result.drafts.length,
      inventedClaimFlags,
      manualInventedClaims: null,
      manualSemanticReview: null,
      ...result,
    });
  } catch {
    results.push({
      id: c.id,
      error: "Execution or validation failed",
      durationMs: Date.now() - started,
      manualSemanticReview: null,
    });
  }
}
await mkdir("evals/results", { recursive: true });
const filename = `evals/results/resume-${config.provider}-${Date.now()}.json`;
const successful = results.filter((r) => "drafts" in r);
const totalFields = successful.reduce(
  (n, r) => n + (r.totalExpectedFields || 0),
  0,
);
const metrics = {
  cases: results.length,
  successful: successful.length,
  failures: results.length - successful.length,
  fieldAccuracy: totalFields
    ? successful.reduce((n, r) => n + (r.correctFields || 0), 0) / totalFields
    : null,
  inventedPhraseFlags: successful.length
    ? successful.reduce((n, r) => n + (r.inventedClaimFlags?.length || 0), 0)
    : null,
  semanticAccuracy: null,
  successfulLatencyMs: successful.map((r) => r.metadata!.durationMs),
};
await writeFile(
  filename,
  JSON.stringify(
    {
      metrics,
      createdAt: new Date().toISOString(),
      provider: config.provider,
      model: config.model,
      note: "Actual synthetic runs. Field matching and forbidden-phrase flags are heuristics, not a complete invented-claim assessment. Complete manual review. Resume citations are not generated or evaluated.",
      results,
    },
    null,
    2,
  ),
);
process.exitCode = metrics.failures > 0 ? 1 : 0;
console.log(
  `Saved ${results.length} synthetic extraction runs to ${filename}. Review before claiming quality results.`,
);

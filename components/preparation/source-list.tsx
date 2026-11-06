import type { PreparationPlanVersion } from "@/lib/preparation-plan";

// The job requirements an item covers, as a labelled list grouped by
// company, instead of one long joined line.
export function SourceList({
  refs,
  plan,
}: {
  refs: { jobId: string; requirementId: string }[];
  plan: Pick<PreparationPlanVersion, "sources"> | undefined;
}) {
  if (!refs.length) return null;
  const groups = new Map<string, string[]>();
  for (const ref of refs) {
    const source = plan?.sources.find((s) => s.jobId === ref.jobId);
    const company = source?.company || "Job";
    const requirement =
      source?.analysis.requirements.find((r) => r.id === ref.requirementId)
        ?.requirement || ref.requirementId;
    groups.set(company, [...(groups.get(company) ?? []), requirement]);
  }
  return (
    <div className="sources">
      {[...groups].map(([company, requirements]) => (
        <div key={company}>
          <p className="sources-label">Covers · {company}</p>
          <ul className="bullets">
            {requirements.map((requirement, i) => (
              <li key={i}>{requirement}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

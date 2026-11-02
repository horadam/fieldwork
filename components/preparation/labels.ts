import type { PreparationPlanVersion } from "@/lib/preparation-plan";

// "Company · requirement" for each job requirement an item covers.
export function sourceLabels(
  refs: { jobId: string; requirementId: string }[],
  plan: Pick<PreparationPlanVersion, "sources"> | undefined,
) {
  return refs
    .map((ref) => {
      const source = plan?.sources.find((s) => s.jobId === ref.jobId);
      const requirement = source?.analysis.requirements.find(
        (r) => r.id === ref.requirementId,
      );
      return `${source?.company || "Job"} · ${requirement?.requirement || ref.requirementId}`;
    })
    .join(" / ");
}

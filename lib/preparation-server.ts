import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace } from "./domain";
import { HttpError } from "./server";
import {
  targetSchema,
  type PreparationState,
  type PreparationTarget,
} from "./preparation-plan";
export async function loadPreparation(
  db: SupabaseClient,
): Promise<PreparationState> {
  const results = await Promise.all(
    ["preparation_targets", "preparation_plans", "preparation_progress"].map(
      (table) => db.from(table).select("payload"),
    ),
  );
  if (results.some((r) => r.error))
    throw new HttpError(
      503,
      "Preparation storage is unavailable. Apply migration 004_preparation_targets.sql to your Supabase project.",
    );
  return {
    targets: results[0].data!.map((r) => r.payload),
    plans: results[1].data!.map((r) => r.payload),
    progress: results[2].data!.map((r) => r.payload),
  };
}
export async function loadSources(
  db: SupabaseClient,
  target: PreparationTarget,
): Promise<Workspace> {
  const results = await Promise.all([
    db.from("applications").select("*").in("id", target.jobIds),
    db.from("analysis_runs").select("*").in("application_id", target.jobIds),
    db.from("experience").select("*"),
  ]);
  if (results.some((r) => r.error))
    throw new HttpError(500, "Could not load preparation sources.");
  return {
    jobs: results[0].data!,
    runs: results[1].data!,
    experience: results[2].data!,
    tasks: [],
  };
}
export async function ownedTarget(db: SupabaseClient, id: string) {
  const result = await db
    .from("preparation_targets")
    .select("payload")
    .eq("id", id)
    .single();
  if (result.error || !result.data)
    throw new HttpError(404, "Preparation target not found.");
  return targetSchema.parse(result.data.payload);
}

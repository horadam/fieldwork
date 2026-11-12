import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./server";
import { validateVersion } from "./preparation-plan";
import { ownedTarget } from "./preparation-server";
export async function ownedPracticePlan(
  db: SupabaseClient,
  id: string,
  active = true,
) {
  const result = await db
    .from("preparation_plans")
    .select("payload,target_id")
    .eq("id", id)
    .single();
  if (result.error || !result.data) throw new HttpError(404, "Plan not found.");
  const target = await ownedTarget(db, result.data.target_id);
  if (active && target.activeVersionId !== id)
    throw new HttpError(409, "Previous plan versions are read-only.");
  return validateVersion(result.data.payload);
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { body, failure, inferenceAccess, HttpError } from "@/lib/server";
import { providerConfig } from "@/lib/ai-provider";
import {
  planSources,
  SourceError,
  targetSchema,
  settingsSchema,
} from "@/lib/preparation-plan";
import { loadSources, ownedTarget } from "@/lib/preparation-server";
import { generatePreparation } from "@/lib/preparation-generation";
import type { Workspace } from "@/lib/domain";
export const runtime = "nodejs";
export const maxDuration = 200;
export async function POST(req: NextRequest) {
  try {
    const access = await inferenceAccess(req);
    const input = z
      .object({
        targetId: z.string().uuid(),
        settings: settingsSchema,
        target: z.unknown().optional(),
        workspace: z.unknown().optional(),
      })
      .parse(await body(req, 1200000));
    const target = access
      ? await ownedTarget(access.db, input.targetId)
      : targetSchema.parse(input.target);
    if (target.id !== input.targetId)
      throw new HttpError(400, "Target mismatch.");
    const workspace = access
      ? await loadSources(access.db, target)
      : (input.workspace as Workspace);
    if (
      !workspace ||
      !Array.isArray(workspace.jobs) ||
      !Array.isArray(workspace.experience) ||
      !Array.isArray(workspace.runs)
    )
      throw new HttpError(400, "Source workspace required.");
    const sources = await planSources(target, workspace);
    const result = await generatePreparation(
      sources,
      input.settings,
      providerConfig(),
      req.signal,
    );
    return NextResponse.json(
      { ...result, sources },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(
      error instanceof SourceError
        ? new HttpError(
            400,
            "Preparation sources are missing or outdated. Run a current real analysis for every selected job.",
          )
        : error,
    );
  }
}

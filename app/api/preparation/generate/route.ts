import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  body,
  failure,
  inferenceAccess,
  HttpError,
  reserveInference,
} from "@/lib/server";
import { requestProvider } from "@/lib/ai-provider";
import {
  planSources,
  SourceError,
  targetSchema,
  settingsSchema,
} from "@/lib/preparation-plan";
import { loadSources, ownedTarget } from "@/lib/preparation-server";
import { generatePreparation } from "@/lib/preparation-generation";
import {
  experienceInput,
  jobInput,
  MAX_JD_CHARS,
  type Workspace,
} from "@/lib/domain";
// Browser-held sources for local mode. Shapes are checked here; analyses are
// re-validated against their evidence by planSources before any model call.
const localSources = z.object({
  jobs: z.array(jobInput.extend({ id: z.string().min(1).max(100) })).max(200),
  experience: z
    .array(
      z.looseObject({
        ...experienceInput.shape,
        id: z.string().min(1).max(100),
      }),
    )
    .max(50),
  runs: z
    .array(
      z.looseObject({
        id: z.string().min(1).max(100),
        application_id: z.string().min(1).max(100),
        status: z.enum(["pending", "running", "completed", "failed"]),
        output: z.unknown(),
        created_at: z.string().max(40),
        jd_snapshot: z.string().max(MAX_JD_CHARS).optional(),
        evidence_snapshot: z
          .array(z.looseObject({ id: z.string() }))
          .max(50)
          .optional(),
      }),
    )
    .max(500),
  tasks: z.array(z.unknown()).max(2000).default([]),
});
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
    let workspace: Workspace;
    if (access) workspace = await loadSources(access.db, target);
    else {
      const parsed = localSources.safeParse(input.workspace);
      if (!parsed.success)
        throw new HttpError(400, "Source workspace required.");
      workspace = parsed.data as Workspace;
    }
    const sources = await planSources(target, workspace);
    const config = requestProvider(req.headers);
    await reserveInference(access, "preparation_generation", config);
    const result = await generatePreparation(
      sources,
      input.settings,
      config,
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

import { NextRequest, NextResponse } from "next/server";
import { authenticated, body, failure, HttpError } from "@/lib/server";
import { importSchema } from "@/lib/resume";
export async function POST(req: NextRequest) {
  try {
    const { db } = await authenticated(req);
    const input = importSchema.parse(await body(req, 300000));
    const result = await db.rpc("import_resume_experience", {
      p_batch_id: input.batchId,
      p_entries: input.entries,
    });
    if (result.error)
      throw new HttpError(
        400,
        "Import could not be saved. Check the 50-entry capacity and apply migrations 002 and 003. No entries in this batch were partially saved.",
      );
    return NextResponse.json({ entries: result.data });
  } catch (error) {
    return failure(error);
  }
}

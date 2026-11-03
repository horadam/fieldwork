import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { body, failure, inferenceAccess, HttpError } from "@/lib/server";
import { fetchJobPage, JobPageError } from "@/lib/job-page";
export const runtime = "nodejs";
export const maxDuration = 20;
export async function POST(req: NextRequest) {
  try {
    // Never opened up by a visitor's key: any string would pass, making this
    // server an open URL fetcher. Visitors without an account paste text.
    await inferenceAccess(req, false, { allowUserKey: false });
    const { url } = z
      .object({ url: z.string().max(2048) })
      .parse(await body(req, 6000));
    return NextResponse.json(await fetchJobPage(url, req.signal), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(
      error instanceof JobPageError
        ? new HttpError(error.status, error.message)
        : error,
    );
  }
}

import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { authenticated } from "../lib/server";

afterEach(() => vi.unstubAllEnvs());
const request = (headers: Record<string, string> = {}) =>
  new NextRequest("http://127.0.0.1:3000/api/workspace", { headers });

it("points to the browser workspace when account storage is not configured", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  await expect(authenticated(request())).rejects.toMatchObject({
    status: 503,
    message: expect.stringContaining("browser workspace"),
  });
});

it("requires a bearer token before contacting Supabase", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "sb_publishable_syntheticTest",
  );
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(authenticated(request())).rejects.toMatchObject({
    status: 401,
  });
  expect(fetcher).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

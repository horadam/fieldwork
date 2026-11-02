import { expect, it } from "vitest";
import { supabaseConfig } from "../lib/supabase-config";
const key = "sb_publishable_syntheticTest";
const jwt = (role: string) =>
  `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role })).replace(/=/g, "")}.synthetic`;
it("keeps browser-only storage available when Supabase is unconfigured", () =>
  expect(supabaseConfig("", "")).toBeNull());
it("normalizes a project URL without exposing key values in diagnostics", () =>
  expect(supabaseConfig(" https://example.supabase.co/ ", ` ${key} `)).toEqual({
    url: "https://example.supabase.co",
    key,
  }));
it("accepts local Supabase and legacy anon JWTs", () => {
  expect(supabaseConfig("http://127.0.0.1:54321", key)?.url).toBe(
    "http://127.0.0.1:54321",
  );
  expect(supabaseConfig("https://example.supabase.co", jwt("anon"))?.key).toBe(
    jwt("anon"),
  );
});
it.each([
  ["https://example.supabase.co", ""],
  ["", key],
  ["not-a-url", key],
  ["https://supabase.com/dashboard/project/test", key],
  ["postgres://user:password@db.example/db", key],
  ["http://remote.example.com", key],
  ["https://user:password@example.supabase.co", key],
  ["https://example.supabase.co/rest/v1", key],
  ["https://example.supabase.co?secret=value", key],
])("rejects incomplete or incorrect configuration", (url, key) =>
  expect(() => supabaseConfig(url, key)).toThrow(),
);
it.each(["sb_secret_doNotExpose", jwt("service_role"), "arbitrary-value"])(
  "rejects privileged/invalid keys without echoing them",
  (key) => {
    try {
      supabaseConfig("https://example.supabase.co", key);
      throw new Error("Expected rejection");
    } catch (error) {
      expect((error as Error).message).toContain("key");
      expect((error as Error).message).not.toContain(key);
    }
  },
);

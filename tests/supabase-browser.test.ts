import { expect, it, vi } from "vitest";
const createClient = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
import { browserSupabase } from "../lib/supabase-browser";

// Regression: an effect that ran twice (Strict Mode, Fast Refresh) created
// a second client on the same storage key.
it("reuses one client for the same project", () => {
  const a = browserSupabase("https://one.supabase.co", "sb_publishable_a");
  const b = browserSupabase("https://one.supabase.co", "sb_publishable_a");
  expect(b).toBe(a);
  expect(createClient).toHaveBeenCalledTimes(1);
  const other = browserSupabase("https://two.supabase.co", "sb_publishable_b");
  expect(other).not.toBe(a);
  expect(createClient).toHaveBeenCalledTimes(2);
});

// The browser's Supabase client. Created once per page and reused: React
// runs effects twice in development and Fast Refresh remounts components,
// and every extra client would share the same stored session and could
// refresh it concurrently ("Multiple GoTrueClient instances detected").
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: { url: string; key: string; client: SupabaseClient } | null = null;

export function browserSupabase(url: string, key: string) {
  if (cached?.url !== url || cached.key !== key)
    cached = { url, key, client: createClient(url, key) };
  return cached.client;
}

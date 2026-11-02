/** Public project credentials only. Never return key values in diagnostics. */
export function supabaseConfig(urlValue?: string, keyValue?: string) {
  const url = urlValue?.trim() || "",
    key = keyValue?.trim() || "";
  if (!url && !key) return null;
  if (!url || !key)
    throw new Error(
      "Set both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then restart the development server.",
    );
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "Use the Supabase project URL from the Connect dialog, such as https://your-project.supabase.co.",
    );
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/" ||
    !(parsed.protocol === "https:" || (parsed.protocol === "http:" && local))
  )
    throw new Error(
      "Use the Supabase project base URL, with HTTPS (or HTTP for local Supabase). Do not use a dashboard URL, database connection string, or API path.",
    );
  if (
    parsed.hostname === "supabase.com" ||
    parsed.hostname.endsWith(".supabase.com")
  )
    throw new Error(
      "Use the project API URL from Connect, not the Supabase dashboard URL.",
    );
  if (key.startsWith("sb_secret_"))
    throw new Error(
      "Use a publishable key in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. A secret key must never be exposed to the browser.",
    );
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    // Keep compatibility with legacy anon JWT keys without admitting service-role keys.
    let role: unknown;
    try {
      const part = key.split(".")[1];
      role = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))).role;
    } catch {
      /* Invalid public key. */
    }
    if (role !== "anon")
      throw new Error(
        "Use the project publishable key (sb_publishable_…) or legacy anon key. Secret and service-role keys are not supported.",
      );
  }
  return { url: parsed.origin, key };
}

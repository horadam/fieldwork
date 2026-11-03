// Browser security policy. The strict script policy matters most because a
// visitor's own OpenAI key sits in browser storage, where any injected script
// could read it.

/**
 * Content-Security-Policy for pages. Scripts run only with this request's
 * nonce (or are loaded by one that has it), so injected markup can't run
 * code. Network calls may go only to this site and, when configured,
 * Supabase. PDF.js needs its worker and WebAssembly, served from this site.
 */
export function contentSecurityPolicy({
  nonce,
  dev,
  supabaseUrl,
}: {
  nonce: string;
  dev: boolean;
  supabaseUrl?: string;
}) {
  let supabase = "";
  try {
    if (supabaseUrl) {
      const { host, protocol } = new URL(supabaseUrl);
      if (protocol === "https:") supabase = ` https://${host} wss://${host}`;
    }
  } catch {
    /* An invalid URL simply isn't allowed. */
  }
  return [
    "default-src 'self'",
    // React needs eval only in development, for readable error stacks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
    // In development, webpack injects stylesheets without the nonce.
    `style-src 'self' ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    // React style={{…}} props; they can't run code.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self'${supabase}${dev ? " ws:" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

// Sent with every response, including API routes.
export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Never sent to other sites; same-origin requests keep it because the
  // local-development guard checks it on GET requests.
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

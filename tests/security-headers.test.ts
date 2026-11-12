import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  contentSecurityPolicy,
  securityHeaders,
} from "../lib/security-headers";
import { proxy } from "../proxy";
import nextConfig from "../next.config";

const directive = (policy: string, name: string) =>
  policy
    .split("; ")
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1);
afterEach(() => vi.unstubAllEnvs());

describe("content security policy", () => {
  const production = contentSecurityPolicy({
    nonce: "abc",
    dev: false,
    supabaseUrl: "https://project.supabase.co",
  });

  it("runs only nonced scripts in production", () => {
    const scripts = directive(production, "script-src")!;
    expect(scripts).toContain("'nonce-abc'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("unsafe-inline");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(directive(production, "style-src")).toBe("'self' 'nonce-abc'");
  });

  it("limits network calls to this site and Supabase", () => {
    expect(directive(production, "connect-src")).toBe(
      "'self' https://project.supabase.co wss://project.supabase.co",
    );
    for (const url of ["http://project.supabase.co", "not a url", undefined])
      expect(
        directive(
          contentSecurityPolicy({ nonce: "n", dev: false, supabaseUrl: url }),
          "connect-src",
        ),
      ).toBe("'self'");
  });

  it("blocks framing, plugins and base-tag tricks", () => {
    expect(directive(production, "frame-ancestors")).toBe("'none'");
    expect(directive(production, "object-src")).toBe("'none'");
    expect(directive(production, "base-uri")).toBe("'self'");
    expect(production).toContain("upgrade-insecure-requests");
  });

  it("relaxes only what Next's development server needs", () => {
    const dev = contentSecurityPolicy({ nonce: "abc", dev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "style-src")).toBe("'self' 'unsafe-inline'");
    expect(directive(dev, "connect-src")).toBe("'self' ws:");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
});

describe("proxy", () => {
  it("sends a fresh nonce to the renderer and the browser", () => {
    vi.stubEnv("NODE_ENV", "production");
    const nonces = [1, 2].map(() => {
      const response = proxy(new NextRequest("https://fieldwork.example/"));
      const policy = response.headers.get("content-security-policy")!;
      const nonce = response.headers.get("x-middleware-request-x-nonce")!;
      expect(policy).toContain(`'nonce-${nonce}'`);
      expect(
        response.headers.get("x-middleware-request-content-security-policy"),
      ).toBe(policy);
      return nonce;
    });
    expect(nonces[0]).not.toBe(nonces[1]);
  });
});

describe("response headers", () => {
  it("apply to every path, API routes included", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/:path*", headers: securityHeaders }]);
  });

  it("keep the referrer for same-origin requests only", () => {
    // The local-development guard reads Referer on same-origin GETs.
    expect(securityHeaders).toContainEqual({
      key: "Referrer-Policy",
      value: "same-origin",
    });
    expect(securityHeaders.map((h) => h.key)).toEqual(
      expect.arrayContaining([
        "X-Content-Type-Options",
        "X-Frame-Options",
        "Permissions-Policy",
        "Strict-Transport-Security",
      ]),
    );
  });
});

it("allows opt-in same-origin recording and local audio previews only", () => {
  const permissions = securityHeaders.find(
    (h) => h.key === "Permissions-Policy",
  )!.value;
  expect(permissions).toContain("microphone=(self)");
  expect(permissions).toContain("camera=()");
  const policy = contentSecurityPolicy({ nonce: "test", dev: false });
  expect(directive(policy, "media-src")).toBe("'self' blob:");
  expect(directive(policy, "connect-src")).toBe("'self'");
  expect(directive(policy, "worker-src")).toBe("'self' blob:");
  expect(directive(policy, "script-src")).toContain("'wasm-unsafe-eval'");
});

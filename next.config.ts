import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@openai/agents"],
  // The page's Content-Security-Policy is set per request in proxy.ts.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default config;

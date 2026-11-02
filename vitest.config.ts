import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  // UI tests opt into jsdom with a `@vitest-environment jsdom` docblock.
  test: { environment: "node", include: ["tests/**/*.test.{ts,tsx}"] },
});

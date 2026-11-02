import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Resume and JD text must never reach a console, on the server or in the browser.
const roots = ["app", "components", "lib"];
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("logging", () => {
  it("has no console calls in app, components, or lib", () => {
    const offenders = roots
      .flatMap(sources)
      .filter((path) => /\bconsole\.\w+\(/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});

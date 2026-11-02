import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const assetRoot = new URL(
  "../public/pdf-assets/pdfjs-5.6.205/",
  import.meta.url,
);
afterEach(() => vi.unstubAllGlobals());

function syntheticPdf() {
  const content =
    "BT /F1 12 Tf 50 740 Td (Synthetic Candidate - Engineer at Example) Tj 0 -20 Td (Built a React interface with the product team.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("same-origin PDF.js distribution", () => {
  it("serves matching, unmodified module and worker builds", async () => {
    for (const name of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
      const served = await readFile(new URL(name, assetRoot));
      const upstream = await readFile(
        new URL(`../vendor/pdfjs/legacy/build/${name}`, import.meta.url),
      );
      expect(served.equals(upstream)).toBe(true);
    }
  });

  it("loads the actual ESM distribution and extracts text from a real PDF", async () => {
    // Text-only Node integration: these browser geometry constructors are never
    // called by getTextContent. This does not exercise canvas rendering or a
    // browser Worker; those still require a browser acceptance check.
    vi.stubGlobal("DOMMatrix", class {});
    vi.stubGlobal("ImageData", class {});
    vi.stubGlobal("Path2D", class {});
    const moduleUrl = new URL("pdf.min.mjs", assetRoot).href;
    const pdfjs: typeof import("pdfjs-dist") = await import(
      /* @vite-ignore */ moduleUrl
    );
    pdfjs.GlobalWorkerOptions.workerSrc = fileURLToPath(
      new URL("pdf.worker.min.mjs", assetRoot),
    );
    const document = await pdfjs.getDocument({
      data: syntheticPdf(),
      standardFontDataUrl: fileURLToPath(
        new URL("../public/pdf-assets/standard_fonts/", import.meta.url),
      ),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
    }).promise;
    try {
      const page = await document.getPage(1);
      const content = await page.getTextContent();
      const text = content.items
        .filter((item) => "str" in item)
        .map((item) => item.str)
        .join(" ");
      expect(text).toContain("Synthetic Candidate - Engineer at Example");
      expect(text).toContain("Built a React interface with the product team.");
    } finally {
      await document.destroy();
    }
  });
});

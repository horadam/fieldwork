import { MAX_RESUME_CHARS, type ResumeSource } from "./resume";
export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export type TextItem = {
  str: string;
  transform: number[];
  width: number;
  hasEOL?: boolean;
};
export type PdfDocument = {
  numPages: number;
  getPage: (
    n: number,
  ) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>;
  destroy: () => Promise<void>;
};
// Keep PDF.js reading order, adding line breaks from actual text positioning. The inspection
// step is required because column ordering and missing glyphs cannot be certified automatically.
export function pageText(items: unknown[]) {
  let text = "",
    previous: TextItem | undefined;
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    const current = item as TextItem;
    const y = current.transform?.[5],
      oldY = previous?.transform?.[5];
    if (
      previous &&
      y !== undefined &&
      oldY !== undefined &&
      Math.abs(y - oldY) > 3 &&
      !text.endsWith("\n")
    )
      text += "\n";
    else if (
      text &&
      !/\s$/.test(text) &&
      current.str &&
      !/^\s/.test(current.str)
    )
      text += " ";
    text += current.str;
    if (current.hasEOL) text += "\n";
    previous = current;
  }
  return text.trim();
}
export async function readPdf(
  file: { size: number; arrayBuffer: () => Promise<ArrayBuffer> },
  load: (bytes: Uint8Array) => Promise<PdfDocument>,
): Promise<{ source: ResumeSource; warnings: string[] }> {
  if (file.size > MAX_PDF_BYTES)
    throw new Error("PDF exceeds 5 MB. Use a smaller PDF or paste text.");
  let document: PdfDocument | undefined;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes("%PDF-"))
      throw new Error(
        "Malformed or unsupported PDF. Paste the resume text instead.",
      );
    document = await load(bytes);
    if (document.numPages > 10)
      throw new Error(
        "PDF exceeds ten pages. Use a shorter PDF or paste text.",
      );
    const pages: ResumeSource["pages"] = [],
      warnings = [
        "Review reading order, columns, missing characters, and completeness before generating drafts.",
      ];
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i),
        text = pageText((await page.getTextContent()).items);
      if (!text)
        warnings.push(
          `Page ${i} has no readable text. It may be scanned or empty; paste any missing content.`,
        );
      pages.push({ page: i, text });
      if (pages.map((p) => p.text).join("\n\n").length > MAX_RESUME_CHARS)
        throw new Error(
          "PDF exceeds 20,000 extracted characters. No text was truncated; use a shorter document.",
        );
    }
    const text = pages
      .map((p) => p.text)
      .join("\n\n")
      .trim();
    if (text.length < 30)
      throw new Error(
        "No usable text found. This PDF may be scanned or empty. OCR is not supported; paste text instead.",
      );
    if (text.includes("\ufffd") || pages.some((p) => p.text.length < 30))
      warnings.push(
        "Text may be incomplete. Compare with the original PDF and paste corrected text if needed.",
      );
    return { source: { text, pages }, warnings };
  } catch (error) {
    if (
      error instanceof Error &&
      /password|encrypt/i.test(error.name + " " + error.message)
    )
      throw new Error(
        "Encrypted/password-protected PDF. Use an unlocked copy or paste text.",
      );
    if (
      error instanceof Error &&
      /exceeds|paste|truncated/i.test(error.message)
    )
      throw error;
    throw new Error(
      "PDF could not be read. It may be malformed or unsupported. Paste text instead.",
    );
  } finally {
    await document?.destroy();
  }
}

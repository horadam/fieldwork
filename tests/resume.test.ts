import { describe, it, expect, vi } from "vitest";
import {
  reviewDrafts,
  resumeSource,
  validateExtraction,
  importLocal,
  likelyDuplicate,
  draftExperience,
  type Draft,
  type ImportBatch,
} from "../lib/resume";
import {
  readPdf,
  pageText,
  MAX_PDF_BYTES,
  type PdfDocument,
} from "../lib/pdf-text";
const text =
  "Acme\nEngineer\n2020–2022\nHelped build a React interface with the platform team.";
const draft: Draft = {
  kind: "role",
  organization: "Acme",
  role: "Engineer",
  dates: "2020–2022",
  accomplishments: ["Helped build a React interface with the platform team."],
  warnings: [],
};
const entry = {
  ...draftExperience(draft),
  itemId: "11111111-1111-4111-8111-111111111111",
  provenance: {
    ...draft,
    provider: "ollama" as const,
    model: "qwen3:8b",
    promptVersion: "resume-v1",
    confirmedAt: "2026-10-21T12:00:00.000Z",
  },
};
const batch: ImportBatch = {
  batchId: "22222222-2222-4222-8222-222222222222",
  entries: [entry],
};
describe("resume drafts and import contracts", () => {
  it("accepts citation-free drafts and warns that details need human review", () => {
    const out = validateExtraction(
      { drafts: [draft], warnings: [] },
      { text, pages: [] },
    );
    expect(out.drafts[0].warnings.join()).toContain("Review roles");
  });
  it("keeps missing dates empty", () => {
    const out = validateExtraction(
      { drafts: [{ ...draft, dates: "" }], warnings: [] },
      { text, pages: [] },
    );
    expect(out.drafts[0].dates).toBe("");
    expect(out.drafts[0].warnings.join()).toContain("Dates");
  });
  it("keeps every model warning when the reminder cap is reached", () => {
    const own = Array.from({ length: 8 }, (_, i) => `Model warning ${i + 1}`);
    const out = validateExtraction(
      { drafts: [{ ...draft, dates: "", warnings: own }], warnings: [] },
      { text, pages: [] },
    );
    expect(out.drafts[0].warnings).toEqual(own);
  });
  it("does not silently shorten a long saved title", () => {
    const long = { ...draft, organization: "A".repeat(150), role: "Engineer" };
    expect(draftExperience(long).title).toBe(`${"A".repeat(150)} · Engineer`);
  });
  it("rejects conflicting page text, malformed JSON shape, and oversize input", () => {
    expect(() =>
      resumeSource.parse({ text, pages: [{ page: 1, text: "unrelated" }] }),
    ).toThrow();
    expect(() =>
      validateExtraction({ drafts: "bad" }, { text, pages: [] }),
    ).toThrow();
    expect(() =>
      resumeSource.parse({ text: "a".repeat(20001), pages: [] }),
    ).toThrow();
  });
  it("imports edited selected entries only, preserves manual records, and is idempotent", () => {
    const manual = {
      id: "old",
      title: "Manual entry",
      body: "User supplied experience",
    };
    const once = importLocal([manual], {
      ...batch,
      entries: [{ ...entry, body: "Edited accomplishment confirmed by user" }],
    });
    expect(once).toHaveLength(2);
    expect(once[0]).toEqual(manual);
    expect(once[1].body).toContain("Edited");
    expect(importLocal(once, batch)).toEqual(once);
  });
  it("rejects the full batch at capacity without mutating records", () => {
    const full = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      title: "Role",
      body: "Confirmed details here",
    }));
    expect(() => importLocal(full, batch)).toThrow("50");
    expect(full).toHaveLength(50);
  });
  it("permits confirmation retry at capacity", () => {
    const records = Array.from({ length: 49 }, (_, i) => ({
      id: String(i),
      title: "Role",
      body: "Confirmed details here",
    }));
    const full = importLocal(records, batch);
    expect(importLocal(full, batch)).toHaveLength(50);
  });
  it("detects normalized provenance and legacy exact content matches", () => {
    const imported = importLocal([], batch);
    expect(
      likelyDuplicate(
        {
          ...entry,
          provenance: { ...entry.provenance, organization: "ACME!" },
        },
        imported,
      ),
    ).toBe(true);
    expect(
      likelyDuplicate(entry, [{ title: entry.title, body: entry.body }]),
    ).toBe(true);
    expect(
      likelyDuplicate(
        { ...entry, provenance: { ...entry.provenance, dates: "2023" } },
        [{ ...imported[0], body: "Different body", title: "Different title" }],
      ),
    ).toBe(false);
  });
});
function file(size = 100) {
  return {
    size,
    arrayBuffer: async () =>
      new TextEncoder().encode("%PDF-1.7 test fixture").buffer,
  };
}
function document(pages: string[]): PdfDocument {
  return {
    numPages: pages.length,
    getPage: async (n) => ({
      getTextContent: async () => ({
        items: [
          { str: pages[n - 1], transform: [1, 0, 0, 1, 0, 100], width: 100 },
        ],
      }),
    }),
    destroy: vi.fn(async () => {}),
  };
}
describe("PDF parsing policy (injected PDF.js reader)", () => {
  it("reads normal PDF pages and preserves page citations", async () => {
    const out = await readPdf(file(), async () => document([text]));
    expect(out.source.pages).toEqual([{ page: 1, text }]);
  });
  it("preserves all multi-column text for inspection without claiming reliable ordering", () => {
    const items = [
      { str: "left column", transform: [1, 0, 0, 1, 10, 100], width: 20 },
      { str: "right column", transform: [1, 0, 0, 1, 210, 100], width: 20 },
    ];
    expect(pageText(items)).toContain("left column right column");
  });
  it.each(["empty", "scanned"])(
    "rejects %s documents with no extracted text",
    async () => {
      await expect(readPdf(file(), async () => document([""]))).rejects.toThrow(
        "scanned",
      );
    },
  );
  it("warns on partially unreadable pages and releases document memory", async () => {
    const doc = document([text, ""]);
    const out = await readPdf(file(), async () => doc);
    expect(out.warnings.join()).toContain("Page 2");
    expect(doc.destroy).toHaveBeenCalled();
  });
  it("reports encrypted documents", async () => {
    await expect(
      readPdf(file(), async () => {
        throw new Error("Password required");
      }),
    ).rejects.toThrow("Encrypted");
  });
  it("rejects malformed documents", async () => {
    await expect(
      readPdf(
        { size: 2, arrayBuffer: async () => new ArrayBuffer(2) },
        async () => document([text]),
      ),
    ).rejects.toThrow("Malformed");
  });
  it("rejects files over 5 MB before reading them", async () => {
    const load = vi.fn();
    await expect(readPdf(file(MAX_PDF_BYTES + 1), load)).rejects.toThrow(
      "5 MB",
    );
    expect(load).not.toHaveBeenCalled();
  });
  it("rejects too many pages and too much text without truncation", async () => {
    await expect(
      readPdf(file(), async () => document(Array(11).fill(text))),
    ).rejects.toThrow("ten pages");
    await expect(
      readPdf(file(), async () => document(["x".repeat(20001)])),
    ).rejects.toThrow("truncated");
  });
});

it("deselects duplicates against existing records and earlier drafts", () => {
  const list = reviewDrafts([draft, draft], []);
  expect(list.map((r) => r.selected)).toEqual([true, false]);
  expect(list[1].duplicate).toBe(true);
  const existing = importLocal([], batch);
  expect(reviewDrafts([draft], existing)[0].selected).toBe(false);
});

it("does not generate or require citation fields", () => {
  const out = validateExtraction(
    {
      drafts: [
        { ...draft, passages: [{ quote: "An obsolete citation", page: 99 }] },
      ],
      warnings: [],
    },
    { text, pages: [] },
  );
  expect(out.drafts[0]).not.toHaveProperty("passages");
  expect(out.drafts[0]).not.toHaveProperty("page");
});
it("reports invalid field paths without rejected model values", () => {
  try {
    validateExtraction(
      {
        drafts: [{ ...draft, dates: { private: "DO_NOT_EXPOSE" } }],
        warnings: [],
      },
      { text, pages: [] },
    );
    throw new Error("Expected rejection");
  } catch (error) {
    expect((error as Error).message).toContain("drafts.0.dates");
    expect((error as Error).message).not.toContain("DO_NOT_EXPOSE");
  }
});
it("imports new provenance without citations and accepts legacy excerpts", () => {
  const imported = importLocal([], batch);
  expect(imported[0].provenance).not.toHaveProperty("passages");
  const legacy = {
    ...entry,
    provenance: {
      ...entry.provenance,
      passages: [{ quote: "Legacy excerpt", page: 1 }],
    },
  };
  expect(
    importLocal([], { ...batch, entries: [legacy] })[0].provenance?.passages,
  ).toHaveLength(1);
});

import { readPdf } from "./pdf-text";

type PdfJs = typeof import("pdfjs-dist");
const moduleUrl = "/pdf-assets/pdfjs-5.6.205/pdf.min.mjs";
const workerUrl = "/pdf-assets/pdfjs-5.6.205/pdf.worker.min.mjs";
let loading: Promise<PdfJs> | undefined;

async function loadPdfJs(): Promise<PdfJs> {
  // PDF.js already contains a Webpack runtime. Load its official compatibility ESM build natively
  // rather than passing that runtime through Next's development bundler again.
  // Both files are versioned, same-origin assets; no CDN or eval is involved.
  loading ??= import(/* webpackIgnore: true */ moduleUrl).then(
    (pdfjs: PdfJs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    },
  );
  try {
    return await loading;
  } catch {
    loading = undefined;
    throw new Error(
      "The PDF reader could not load. Refresh the page and try again, or paste your resume text.",
    );
  }
}

export async function parseResumePdf(file: File) {
  return readPdf(file, async (bytes) => {
    const pdfjs = await loadPdfJs();
    return pdfjs.getDocument({
      data: bytes,
      cMapUrl: "/pdf-assets/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdf-assets/standard_fonts/",
      wasmUrl: "/pdf-assets/wasm/",
      isEvalSupported: false,
      stopAtErrors: true,
    }).promise;
  });
}

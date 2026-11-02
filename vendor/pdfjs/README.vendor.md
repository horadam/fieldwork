PDF.js 5.6.205 browser distribution, Mozilla, Apache-2.0 (see LICENSE).
Copied without source changes from the locally available pdfjs-dist distribution because
registry access was unavailable during implementation. Package manifest omits optional
Node-only canvas/stream dependencies; this application parses PDFs in a browser worker.
Build files, TypeScript declarations, CMaps, standard fonts and WASM are retained.
Source maps are omitted. Fonts/CMaps/WASM also live in public/pdf-assets for same-origin loads.
Upstream: https://github.com/mozilla/pdf.js and https://mozilla.github.io/pdf.js/
To update, replace these files with a reviewed official pdfjs-dist release, copy assets
to public/pdf-assets, update this manifest/version and regenerate pnpm-lock.yaml.

The browser loader now uses the upstream legacy/build/pdf.min.mjs and
pdf.worker.min.mjs compatibility builds, copied unchanged to
public/pdf-assets/pdfjs-5.6.205/. Load them as native ESM with webpackIgnore;
rebundling PDF.js through Next development Webpack can break its internal runtime.
Update the module/worker together; the asset regression test checks byte identity.

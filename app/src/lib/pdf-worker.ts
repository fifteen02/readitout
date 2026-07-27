// The pdf.js worker entry point. It exists so the ES2025 Uint8Array polyfill is
// installed in the worker realm before pdf.js runs — the main thread's copy does
// not reach here. Import order is the whole point of this file.
import "./es2025-uint8array";
import "pdfjs-dist/build/pdf.worker.mjs";

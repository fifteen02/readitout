import { defineConfig } from "vite";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp"
};
export default defineConfig({
  preview: { headers: isolationHeaders },
  server: {
    port: 5273,
    headers: isolationHeaders
  },
  // pdf.js instantiates its worker with `{ type: "module" }`, so the worker
  // bundle has to be ESM — Vite's build default of iife would not load.
  worker: {
    format: "es"
  },
  build: {
    outDir: "dist/public",
    emptyOutDir: true
  }
});

import { defineConfig } from "vite";

// Front-end dev server proxies API calls to the TypeScript node server.
export default defineConfig({
  server: {
    port: 5273,
    proxy: {
      "/api": "http://localhost:4173"
    }
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

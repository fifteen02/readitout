import { defineConfig } from "vite";

// Front-end dev server proxies API calls to the TypeScript node server.
export default defineConfig({
  server: {
    port: 5273,
    proxy: {
      "/api": "http://localhost:4173"
    }
  },
  build: {
    outDir: "dist/public",
    emptyOutDir: true
  }
});

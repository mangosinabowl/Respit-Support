import { defineConfig } from "vite";

// Served from https://<user>.github.io/Respit-Support/, so assets must be
// requested relative to that subpath rather than the domain root.
export default defineConfig({
  base: "/Respit-Support/",
  build: { outDir: "docs", emptyOutDir: true },
  server: { port: 5173 },
});

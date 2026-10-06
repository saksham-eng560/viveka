import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import { resolve } from "node:path";
import manifest from "./manifest.json";

// Tooling decision: Vite ^7 + @crxjs/vite-plugin 3.0.0 (its peer range covers Vite 3-8).
// If 3.0.0 ever fails to build, fall back to the latest 2.x release of @crxjs/vite-plugin.
export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest: manifest as never })],
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        offscreen: resolve(__dirname, "src/offscreen/index.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});

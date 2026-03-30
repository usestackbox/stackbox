import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "src",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4322",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:4322",
        ws: true,
        changeOrigin: true,
      },
    },
    watch: {
      // Only watch files inside desktop/src/ for HMR.
      // Without this, Vite reloads the app whenever the file tree
      // panel creates/deletes/renames files anywhere in the project.
      ignored: [
        "**/node_modules/**",
        "**/src-tauri/**",
        "**/dist/**",
        // Ignore anything that isn't a source file
        (path: string) => {
          // Always watch desktop/src/** (our actual source)
          if (path.includes("/desktop/src/")) return false;
          // Ignore everything else (user project files, etc.)
          return true;
        },
      ],
    },
  },
});
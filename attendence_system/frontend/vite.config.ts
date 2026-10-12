import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev the browser talks only to Vite (port 5173). Vite forwards API and image calls to FastAPI,
// so the session cookie is same-origin and no CORS setup is needed.
const BACKEND = process.env.VITE_BACKEND ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
      "/media": { target: BACKEND, changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});

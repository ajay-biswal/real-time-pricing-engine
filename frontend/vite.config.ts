import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const backendOrigin = env.VITE_BACKEND_ORIGIN || "http://localhost:5000";

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        "/health": { target: backendOrigin, changeOrigin: true },
        "/api": { target: backendOrigin, changeOrigin: true },
        "/ws": {
          target: backendOrigin.replace(/^http/, "ws"),
          ws: true,
          changeOrigin: true
        }
      }
    }
  };
});
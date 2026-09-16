import process from "node:process";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createDevApiProxy } from "./dev/apiProxy.js";

export default defineConfig(({ command, mode, isPreview }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const backendUrl = process.env.VITE_BACKEND_URL || env.VITE_BACKEND_URL;
  const proxyDevApi =
    command === "serve" && !isPreview && /^https?:\/\//.test(backendUrl || "");
  return {
    plugins: [react(), tailwindcss()],
    ...(proxyDevApi
      ? {
          define: {
            "import.meta.env.VITE_BACKEND_URL": JSON.stringify("/api/v1"),
            "import.meta.env.VITE_DEV_BACKEND_TARGET":
              JSON.stringify(backendUrl),
          },
          server: {
            strictPort: true,
            proxy: createDevApiProxy(backendUrl),
          },
        }
      : {}),
  };
});

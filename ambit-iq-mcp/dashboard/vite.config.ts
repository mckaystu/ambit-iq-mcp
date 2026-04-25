import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/** Dev-only: deep links like /dashboard/policies serve index.html (matches Vercel SPA rewrite). */
function spaHistoryFallback() {
  return {
    name: "spa-history-fallback",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const raw = req.url?.split("?")[0] ?? "";
        if (req.method !== "GET") return next();
        if (raw.startsWith("/api") || raw.startsWith("/@") || raw.startsWith("/node_modules")) return next();
        if (raw.includes(".") && !raw.endsWith("/")) return next();
        if (raw === "/" || raw === "") return next();
        req.url = "/";
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_DEV_API_PROXY_TARGET?.replace(/\/$/, "");

  return {
    plugins: [react(), spaHistoryFallback()],
    server: proxyTarget
      ? {
          proxy: {
            "/api": {
              target: proxyTarget,
              changeOrigin: true,
            },
          },
        }
      : undefined,
  };
});

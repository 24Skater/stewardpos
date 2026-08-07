import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { componentTagger } from "lovable-tagger";

/**
 * Where the dev server forwards API traffic.
 *
 * Dev and production reach the backend differently: here the proxy lets
 * `VITE_API_BASE_URL` stay empty so the app issues same-origin `/api` requests,
 * while the built bundle uses whatever absolute base URL it was compiled with.
 * See `docs/reference/environment.md`.
 */
const BACKEND_ORIGIN = process.env.VITE_DEV_API_PROXY_TARGET || "http://localhost:3002";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 5174,
    proxy: {
      "/api": {
        target: BACKEND_ORIGIN,
        changeOrigin: true,
        secure: false,
        // Drop the browser's Origin header on the way through.
        //
        // From the browser this *is* a same-origin request — it asks
        // localhost:5174 and the proxy is transparent infrastructure. But
        // browsers still attach Origin to same-origin POSTs (not to GETs), and
        // `changeOrigin` only rewrites Host, so the backend saw the dev server's
        // origin, found it absent from CORS_ORIGIN, and refused. The symptom was
        // specific and confusing: reads worked, writes failed.
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => proxyReq.removeHeader("origin"));
        },
      },
      // Uploaded logos and icons are stored as relative `/uploads/...` URLs, so
      // they need the same treatment or they 404 against the dev server.
      "/uploads": {
        target: BACKEND_ORIGIN,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  plugins: [
    tailwindcss(),
    react(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));

import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3000,
    // Listen on all interfaces (lets a tunnel reach the dev server if needed).
    host: true,
    // Vite rejects requests whose Host header it doesn't recognise. The Wallet
    // loads the app from localhost directly, so only localhost is allowed. If
    // you tunnel the dev server (e.g. ngrok) to test inside the Wallet, add the
    // tunnel host here — dev-only.
    allowedHosts: ["localhost"],
    // Safe App iframe embedding requires permissive headers in dev
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  },
});
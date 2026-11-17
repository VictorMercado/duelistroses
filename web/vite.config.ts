import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from "path";
import { execSync } from "child_process";
import { readFileSync } from "fs";

// Which build a client error report came from (see src/net/errorReport.ts).
// The Docker build has no .git, so it passes BUILD_SHA instead.
const version = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")).version as string;
const commit = process.env.BUILD_SHA || (() => {
  try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "unknown"; }
})();

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit),
  },
  server: {
    host: true,
    proxy: {
      // Forward websocket upgrades to the Go server (main.go listens on :8080)
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
      // The API and every asset file live on the Go server too.
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/assets': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Off in development: a service worker there serves stale bundles and
      // makes changes look like they did not take.
      devOptions: {
        enabled: false
      },
      registerType: 'autoUpdate',
      workbox: {
        // Never answer API or websocket routes from the app shell.
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//, /^\/assets\//, /^\/\.well-known\//],
      },
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'Duelist City',
        short_name: 'Duelist',
        description: 'Duelist City',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  build: {
    // "/assets" is where the server serves card art and sounds, so the
    // bundle's own files go elsewhere.
    assetsDir: 'app',
  },
  resolve: {
    // One alias for the whole source tree: "@/x/y" is "src/x/y".
    alias: { "@": resolve(__dirname, "src") },
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from "path";

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      devOptions: {
        enabled: true
      },
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'Duelist City',
        short_name: 'Duelist',
        description: 'Duelist City',
        theme_color: '#000000',
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
  resolve: {
    alias: {
      "@/": resolve(__dirname, "./src"),
      "@/app": resolve(__dirname, "src", "app"),
      "@/components": resolve(__dirname, "src", "components"),
      "@/hooks": resolve(__dirname, "src", "hooks"),
      "@/lib": resolve(__dirname, "src", "lib"),
      "@/routes": resolve(__dirname, "src", "routes"),
      "@/stores": resolve(__dirname, "src", "stores"),
      "@/types": resolve(__dirname, "src", "types"),
      "@/lib/utils": resolve(__dirname, "src", "lib", "utils"),
      "@/data": resolve(__dirname, "src", "data"),
      "@/shaders": resolve(__dirname, "src", "shaders"),
      "@/const": resolve(__dirname, "src", "const"),
      "@/game": resolve(__dirname, "src", "game"),
    },
  },
});

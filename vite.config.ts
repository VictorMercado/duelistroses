import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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

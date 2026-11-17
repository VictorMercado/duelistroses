import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the content API runs on :5080 and this app on :5174.
// A production build is written into the API's wwwroot, so the one .NET
// process serves the deck builder, the API and the assets.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:5080', '/assets': 'http://localhost:5080' },
  },
  build: {
    outDir: '../api/wwwroot',
    // wwwroot also holds the imported game assets: never wipe it.
    emptyOutDir: false,
    // "assets" is taken by the game assets, so the bundle goes elsewhere.
    assetsDir: 'app',
  },
});

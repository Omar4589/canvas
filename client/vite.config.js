import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // dist/.vite/manifest.json — read by scripts/prerender.js to preload a prerendered page's chunk.
  // (express.static serves no dot-directory, so it never goes out.)
  build: { manifest: true },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});

import { defineConfig } from 'vite';

// `npm run dev` startet Vite (Hot Reload) und leitet /api inkl. WebSockets an
// `npm run dev:worker` (wrangler dev, Port 8787) weiter.
export default defineConfig({
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8787', ws: true },
    },
  },
});

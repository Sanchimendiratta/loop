import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174 },
  build: { outDir: 'dist', rollupOptions: { input: { main: at('./index.html') } } },
  // `src/sw.ts` is registered via `?worker&url` (see `main.tsx`). Forcing a
  // classic (non-ES-module) bundle for it, rather than trusting whatever
  // this Vite version defaults `worker.format` to, is the one thing this
  // config needs to say: `navigator.serviceWorker.register` then needs no
  // `{ type: 'module' }`, which keeps the worker registrable in browsers
  // that never picked up module service worker support.
  worker: { format: 'iife' },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});

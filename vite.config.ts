import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174 },
  build: { outDir: 'dist', rollupOptions: { input: { main: at('./index.html') } } },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});

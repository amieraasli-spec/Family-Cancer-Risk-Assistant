import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Two separate entry points, built as two separate bundles:
 *
 *   index.html    the staff application
 *   semakan.html  the applicant portal (Semakan Status Laporan Perubatan)
 *
 * They are kept apart so no staff component, and no staff API client, can end up
 * in the bundle a member of the public downloads.
 */
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        staff: resolve(import.meta.dirname, 'web/index.html'),
        semakan: resolve(import.meta.dirname, 'web/semakan.html'),
      },
    },
  },
  server: {
    port: 4181,
    proxy: {
      // The API runs as its own process; nothing about it is bundled into the client.
      '/api': { target: 'http://localhost:4180', changeOrigin: false },
    },
  },
});

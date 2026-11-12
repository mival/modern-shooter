import { defineConfig } from 'vite';

// The relative base path lets a desktop wrapper load the client from files.
export default defineConfig({
  root: 'client',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { fs: { allow: ['..'] } },
});

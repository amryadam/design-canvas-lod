import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist/app', emptyOutDir: true },
});

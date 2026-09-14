import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist/embed',
    emptyOutDir: true,
    lib: {
      entry: 'src/workspace.tsx',
      name: 'DesignWorkspace',
      formats: ['iife'],
      fileName: 'design-workspace',
    },
  },
});

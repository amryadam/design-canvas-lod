import { defineConfig } from 'vite';

// One IIFE file with React and React Flow inside. The CSS is imported as a
// string (?inline) and injected by mount(), so there is no second file.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    lib: { entry: 'src/main.jsx', name: 'RFSpike', formats: ['iife'], fileName: () => 'spike.js' },
    outDir: 'dist',
    emptyOutDir: true,
  },
});

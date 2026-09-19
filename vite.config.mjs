import { defineConfig } from 'vite';

// One IIFE file with React, React Flow and the CSS inside (the CSS is
// imported as a string with ?inline and injected by mount()). The global
// name is DesignCanvas: a page calls DesignCanvas.mount(el, opts).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    lib: { entry: 'src/main.jsx', name: 'DesignCanvas', formats: ['iife'], fileName: () => 'design-canvas.js' },
    outDir: 'dist',
    emptyOutDir: true,
  },
});

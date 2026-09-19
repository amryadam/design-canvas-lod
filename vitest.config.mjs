import { defineConfig } from 'vitest/config';

// The unit tests cover the pure modules only; the React layer is checked in
// a real browser by tests/.
export default defineConfig({
  test: { include: ['src/**/*.test.js'], environment: 'node' },
});

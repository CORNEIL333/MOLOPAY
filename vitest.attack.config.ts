import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/attack/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30_000,
  },
});

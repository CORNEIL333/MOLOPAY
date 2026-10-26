import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/*.db.test.ts', 'tests/db/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});

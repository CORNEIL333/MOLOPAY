import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/*.e2e.test.ts', 'tests/e2e/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30_000,
  },
});

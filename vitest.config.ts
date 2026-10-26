import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'tools/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/*.db.test.ts',
      '**/*.e2e.test.ts',
      'tests/db/**',
      'tests/attack/**',
      'tests/e2e/**',
    ],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 20_000,
  },
});

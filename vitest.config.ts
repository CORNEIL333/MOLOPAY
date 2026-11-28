import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@achat/money': resolve(__dirname, './packages/money/src/index.ts'),
    },
  },
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
      '**/*.live.test.ts',
      'tests/db/**',
      'tests/attack/**',
      'tests/e2e/**',
    ],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 20_000,
  },
});

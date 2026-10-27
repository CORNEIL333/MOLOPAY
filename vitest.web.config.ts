import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const fromRoot = (relative: string): string =>
  resolve(__dirname, relative);

export default defineConfig({
  plugins: [react({})],
  resolve: {
    alias: {
      '@achat/ui': fromRoot('./packages/ui/src/index.ts'),
      '@achat/contracts/api': fromRoot('./packages/contracts/src/api.d.ts'),
      '@achat/contracts/client': fromRoot('./packages/contracts/src/client.ts'),
      '@achat/contracts': fromRoot('./packages/contracts/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    include: [
      'packages/ui/src/**/*.test.tsx',
      'apps/web-client/src/**/*.test.tsx',
      'apps/partner-portal/src/**/*.test.tsx',
      'apps/back-office/src/**/*.test.tsx',
    ],
    setupFiles: ['./vitest.web.setup.ts'],
    testTimeout: 20_000,
  },
});

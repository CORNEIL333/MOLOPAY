import { defineConfig } from 'vitest/config';

/** D1 : test réel contre l'environnement de test officiel de Twilio (identifiants hors dépôt). */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/api/src/**/*.live.test.ts'],
    exclude: ['**/node_modules/**'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30_000,
  },
});

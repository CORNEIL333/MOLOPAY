import { describe, expect, it } from 'vitest';
import { evaluateImport } from '../../tools/boundaries';
import { findSecrets } from '../../tools/scan-secrets';

describe('Défenses structurelles (outillage)', () => {
  it('SEC-SDLC-002 refuse un faux PostgreSQL pg-mem', () => {
    expect(
      evaluateImport({
        sourcePath: 'apps/api/src/modules/ledger/repository.ts',
        specifier: 'pg-mem',
      }),
    ).toEqual({
      code: 'SIMULATION_FORBIDDEN',
      source: 'apps/api/src/modules/ledger/repository.ts',
      specifier: 'pg-mem',
    });
  });

  it('SEC-AUTHZ-001 refuse ledger -> payments (frontière CDC_05 §3)', () => {
    expect(
      evaluateImport({
        sourcePath: 'apps/api/src/modules/ledger/service.ts',
        specifier: '../payments/service',
      }),
    ).toEqual({
      code: 'MODULE_BOUNDARY_VIOLATION',
      source: 'apps/api/src/modules/ledger/service.ts',
      specifier: '../payments/service',
    });
  });

  it('CDC_05 §3 autorise ledger -> audit', () => {
    expect(
      evaluateImport({
        sourcePath: 'apps/api/src/modules/ledger/service.ts',
        specifier: '../audit/journal',
      }),
    ).toBeNull();
  });

  it('NF-FUN-001 interdit à packages/money d’importer apps', () => {
    expect(
      evaluateImport({
        sourcePath: 'packages/money/src/index.ts',
        specifier: '../../../apps/api/src/main',
      }),
    ).toEqual({
      code: 'PACKAGE_BOUNDARY_VIOLATION',
      source: 'packages/money/src/index.ts',
      specifier: '../../../apps/api/src/main',
    });
  });

  it('SEC-CRY-004 détecte une clé AWS synthétique', () => {
    const fakeKey = ['AKIA', 'Q'.repeat(16)].join('');
    const findings = findSecrets('config.ts', `const key = '${fakeKey}';`);
    expect(findings).toEqual([
      { file: 'config.ts', line: 1, rule: 'AWS_ACCESS_KEY' },
    ]);
  });

  it('SEC-CRY-004 détecte un fichier .env versionné', () => {
    expect(findSecrets('.env.local', 'PORT=3000')).toEqual([
      { file: '.env.local', line: 1, rule: 'ENV_FILE_TRACKED' },
    ]);
  });

  it('SEC-CRY-004 ne signale pas un code sans secret', () => {
    expect(
      findSecrets('service.ts', 'export const status = process.env.STATUS;'),
    ).toEqual([]);
  });
});

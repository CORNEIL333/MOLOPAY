import { describe, expect, it } from 'vitest';
import { evaluateImport } from './boundaries';
import { findSecrets } from './scan-secrets';

describe('check-boundaries', () => {
  it('laisse passer un import de bibliothèque externe', () => {
    expect(
      evaluateImport({
        sourcePath: 'apps/api/src/modules/ledger/service.ts',
        specifier: 'node:crypto',
      }),
    ).toBeNull();
  });

  it('interdit à un module d’importer un schéma SQL', () => {
    expect(
      evaluateImport({
        sourcePath: 'apps/api/src/modules/ledger/service.ts',
        specifier: '../../../../../db/migrations/0001_ledger.sql',
      }),
    ).toEqual({
      code: 'DB_SCHEMA_IMPORT_FORBIDDEN',
      source: 'apps/api/src/modules/ledger/service.ts',
      specifier: '../../../../../db/migrations/0001_ledger.sql',
    });
  });

  it('interdit un import inter-packages non déclaré', () => {
    expect(
      evaluateImport({
        sourcePath: 'packages/contracts/src/index.ts',
        specifier: '@achat/api',
      }),
    ).toEqual({
      code: 'PACKAGE_BOUNDARY_VIOLATION',
      source: 'packages/contracts/src/index.ts',
      specifier: '@achat/api',
    });
  });
});

describe('scan-secrets', () => {
  it('détecte un bloc de clé privée', () => {
    const marker = ['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' ');
    expect(findSecrets('id_key', marker)).toEqual([
      { file: 'id_key', line: 1, rule: 'PRIVATE_KEY_BLOCK' },
    ]);
  });

  it('ignore le fichier .env.example pour la règle générique', () => {
    const variable = ['API', 'TOKEN'].join('_');
    const value = ['abcdefghij', 'klmnopqrstuvwx'].join('');
    expect(findSecrets('.env.example', `${variable}='${value}'`)).toEqual([]);
  });
});

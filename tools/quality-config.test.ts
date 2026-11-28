import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * NF-MNT-004 : code typé strictement ; aucun `any` dans les modules financiers.
 * Vérifie la configuration réellement appliquée (et non un fichier supposé) :
 * TypeScript `strict`, règles `any` / `unsafe` en erreur sur chaque fichier des
 * modules financiers, et aucune directive qui les désactive.
 */
const FINANCIAL = ['apps/api/src/modules/ledger', 'apps/api/src/modules/payments', 'apps/api/src/modules/settlement', 'apps/api/src/modules/reconciliation', 'packages/money/src'];
const RULES = [
  '@typescript-eslint/no-explicit-any',
  '@typescript-eslint/no-unsafe-assignment',
  '@typescript-eslint/no-unsafe-member-access',
  '@typescript-eslint/no-unsafe-call',
  '@typescript-eslint/no-unsafe-return',
  '@typescript-eslint/no-unsafe-argument',
];

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) ? [path] : [];
  });
}

const files = FINANCIAL.flatMap(sources);

describe('NF-MNT-004 typage strict et aucun any dans les modules financiers', () => {
  it('TypeScript en mode strict (configuration lue par le compilateur)', () => {
    const read = ts.readConfigFile('tsconfig.json', (path) => ts.sys.readFile(path));
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, process.cwd());
    expect(parsed.options.strict).toBe(true);
    expect(parsed.fileNames.some((name) => name.includes('apps/api/src/modules/ledger/'))).toBe(true);
  });

  it('les règles any / unsafe sont en erreur sur chaque fichier financier', async () => {
    expect(files.length).toBeGreaterThan(20);
    const eslint = new ESLint();
    for (const file of files) {
      const config = (await eslint.calculateConfigForFile(file)) as { rules?: Record<string, unknown> };
      for (const rule of RULES) {
        const setting = config.rules?.[rule];
        const level: unknown = Array.isArray(setting) ? (setting as unknown[])[0] : setting;
        expect([2, 'error'], `${file} · ${rule}`).toContain(level);
      }
    }
  }, 120_000);

  it('aucune directive ne désactive le contrôle ni n’introduit any explicitement', () => {
    const offenders = files.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return /eslint-disable|@ts-ignore|@ts-nocheck|@ts-expect-error|:\s*any\b|as\s+any\b|<any>/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});

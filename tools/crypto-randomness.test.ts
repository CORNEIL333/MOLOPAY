import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SEC-CRY-005 : seuls des générateurs aléatoires cryptographiques sont
 * utilisés (codes de remise, OTP, nonces, jetons, identifiants). Contrôle
 * statique de tout le code de production (applications, paquets, outils) :
 * `Math.random` y est interdit ; les tests peuvent l'employer.
 */
const ROOT = resolve(__dirname, '..');
const SCANNED = ['apps', 'packages', 'tools'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', 'target', 'coverage', 'fixtures']);

function sources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(entry) || entry.startsWith('.')) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sources(path));
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      found.push(path);
    }
  }
  return found;
}

describe('SEC-CRY-005 générateurs aléatoires cryptographiques uniquement', () => {
  it('le contrôle porte sur le code de production (plusieurs centaines de fichiers)', () => {
    expect(SCANNED.flatMap((folder) => sources(join(ROOT, folder))).length).toBeGreaterThan(200);
  });

  it('aucun Math.random dans le code de production', () => {
    const offenders = SCANNED.flatMap((folder) => sources(join(ROOT, folder)))
      .filter((path) => /\bMath\s*\.\s*random\b/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });
});

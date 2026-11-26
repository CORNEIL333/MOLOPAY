import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * NF-SAFE-001 (et AGENTS.md § 8) : aucune mécanique de loterie, de ticket à
 * gratter ou de rémunération au clic. Contrôle statique de tout le code de
 * production et de tous les textes montrés aux clients (web, mobile, USSD,
 * notifications, contrat d'API) : le vocabulaire de ces mécaniques, en
 * français comme en anglais, en texte comme en identifiant, y est refusé.
 * Introduire une telle mécanique exigerait donc de retirer ce contrôle, ce
 * qu'interdit le § 8 sans ADR du fondateur.
 */
const ROOT = resolve(__dirname, '..');
const SCANNED = ['apps', 'packages', 'tools', 'db', 'tests/attack'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', 'target', 'coverage', 'test', 'build', '.dart_tool']);
const SELF = resolve(__filename);

export const FORBIDDEN = new RegExp(
  [
    'loteries?', 'lotto', 'lotter(?:y|ies)', 'tombolas?', 'jackpots?', 'raffles?', 'sweepstakes?', 'prizes?',
    'scratch[ _-]?cards?', 'tickets? à gratter', 'à gratter', 'tirages? au sort', 'lucky[ _-]?draws?', 'prize[ _-]?draws?',
    'spin[ _-]the[ _-]wheel', 'roue de la (?:fortune|chance)', 'gagnez', 'à gagner', 'cash[ _-]?back',
    'pay[ _-]?per[ _-]?click', 'per[ _-]?click', 'par clic', 'au clic',
  ].map((term) => `(?<![\\p{L}\\p{N}])${term}(?![\\p{L}\\p{N}])`).join('|'),
  'iu',
);

function sources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(entry) || entry.startsWith('.')) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sources(path));
    } else if (/\.(ts|tsx|sql|dart|rs|json|md)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) && !/_test\.dart$/.test(entry) && !entry.endsWith('.d.ts') && path !== SELF) {
      found.push(path);
    }
  }
  return found;
}

describe('NF-SAFE-001 aucune mécanique de loterie, de grattage ni de rémunération au clic', () => {
  const files = SCANNED.flatMap((top) => sources(resolve(ROOT, top)));

  it('le contrôle couvre le code et les textes de toutes les interfaces', () => {
    expect(files.length).toBeGreaterThan(300);
    for (const expected of ['apps/web-client/src/i18n', 'apps/mobile/lib/l10n/strings.dart', 'packages/contracts/openapi.json', 'apps/api/src/workflows/notify.ts', 'db/migrations/0001_ledger.sql']) {
      expect(files.some((file) => relative(ROOT, file).startsWith(expected)), expected).toBe(true);
    }
  });

  it('aucun fichier de production ne contient ce vocabulaire (texte ou identifiant)', () => {
    const offenders = files.flatMap((file) => {
      const lines = readFileSync(file, 'utf8').split('\n');
      return lines.flatMap((line, index) => (FORBIDDEN.test(line) ? [`${relative(ROOT, file)}:${index + 1}`] : []));
    });
    expect(offenders).toEqual([]);
  });

  it('refuse : chaque forme est détectée, en français, en anglais, en identifiant (contrôle du contrôle)', () => {
    for (const sample of [
      'Gagnez un smartphone !', 'Tirage au sort mensuel', 'ticket à gratter', 'LOTTERY_ENTRY', 'prizeDraw', 'lucky_draw', 'scratchCard',
      'Spin the wheel', 'cashback de 2 %', 'PAY_PER_CLICK', 'rémunération au clic', 'Jackpot', 'tombola', 'Win a prize',
    ]) {
      expect(FORBIDDEN.test(sample), sample).toBe(true);
    }
  });

  it('ne refuse pas les mots ordinaires voisins (pas de faux positif sur le vocabulaire du produit)', () => {
    for (const sample of ['enterprise', 'surprise', 'click', 'cliquez ici', 'retrait', 'withdraw', 'gratuit', 'lot de pièces', 'objectif atteint', 'payback period']) {
      expect(FORBIDDEN.test(sample), sample).toBe(false);
    }
  });
});

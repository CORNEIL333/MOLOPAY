import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ERROR_CODES, ERROR_MESSAGES } from '../packages/contracts/src/errors';
import { describe, expect, it } from 'vitest';

/**
 * S5 (revue d'intégration) : le catalogue FR/EN est la seule source du `title`
 * RFC 9457. Le typage impose `Record<ErrorCode, ErrorMessage>`, mais il ne peut
 * pas vérifier qu'un code levé par l'API figure bien dans `ERROR_CODES` : la
 * liste des codes émis se lit donc dans le code réel, pas dans une liste tenue
 * à la main. Un refus ajouté sans message fait échouer ce contrôle.
 */
const ROOT = resolve(__dirname, '..');
const API_SOURCE = resolve(ROOT, 'apps/api/src');
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage']);

/** `new BusinessError('CODE'…)`, éventuellement sur plusieurs lignes. */
const BUSINESS_ERROR = /\bnew\s+BusinessError\(\s*'([A-Z][A-Z0-9_]*)'/g;

export function businessErrorCodes(source: string): string[] {
  return [...source.matchAll(BUSINESS_ERROR)].map((match) => match[1] as string);
}

const toPosix = (path: string): string => path.split('\\').join('/');

function typeScriptSources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(entry) || entry.startsWith('.')) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...typeScriptSources(path));
    } else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

describe('S5 · complétude du catalogue d’erreurs FR/EN', () => {
  const files = typeScriptSources(API_SOURCE);
  const emissions = files.flatMap((file) =>
    businessErrorCodes(readFileSync(file, 'utf8')).map((code) => ({
      code,
      file: toPosix(relative(ROOT, file)),
    })),
  );

  it('le contrôle extrait les codes réels, sous leurs deux formes d’écriture', () => {
    expect(businessErrorCodes("throw new BusinessError('AGREEMENT_LOCKED', 'verrouillé');")).toEqual(['AGREEMENT_LOCKED']);
    expect(businessErrorCodes("throw new BusinessError(\n    'SETTLEMENT_FREEZE_EXPIRED',\n    'gel expiré',\n  );")).toEqual([
      'SETTLEMENT_FREEZE_EXPIRED',
    ]);
    expect(businessErrorCodes('return new BusinessError(code, message);')).toEqual([]);
    expect(businessErrorCodes("new BusinessError('pas_un_code', 'x');")).toEqual([]);
  });

  it('le contrôle couvre tout le code de l’API, sans fichier de test', () => {
    expect(files.length).toBeGreaterThan(150);
    const codes = new Set(emissions.map(({ code }) => code));
    expect(codes.size).toBeGreaterThanOrEqual(95);
    for (const representative of [
      'CLIENT_UPGRADE_REQUIRED',
      'IDENTITY_TERMS_NOT_ACCEPTED',
      'REPORT_PERIOD_INVALID',
      'SIGNING_UNAVAILABLE',
      'SMS_DELIVERY_FAILED',
    ]) {
      expect(codes.has(representative), representative).toBe(true);
    }
    expect(files.some((file) => /\.test\.ts$/.test(file))).toBe(false);
  });

  it('chaque code levé par l’API existe dans le catalogue et y a un message FR et EN', () => {
    const missing = emissions.filter(({ code }) => !Object.hasOwn(ERROR_CODES, code));
    expect(missing).toEqual([]);

    const withoutMessage = [...new Set(emissions.map(({ code }) => code))].filter((code) => {
      const message = ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES];
      return message === undefined || message.fr.trim() === '' || message.en.trim() === '';
    });
    expect(withoutMessage).toEqual([]);
  });

  it('le catalogue ne contient aucun code orphelin ni message vide', () => {
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual(Object.keys(ERROR_CODES).sort());
    for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
      expect(message.fr.trim(), `${code} fr`).not.toBe('');
      expect(message.en.trim(), `${code} en`).not.toBe('');
    }
  });
});
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_MESSAGES, errorMessage, problemLocaleFromHeader } from './errors';

const CODES = Object.keys(ERROR_CODES) as (keyof typeof ERROR_CODES)[];

describe('NF-UX-002 · catalogue des erreurs FR/EN', () => {
  it('chaque code possède un message français et anglais, non vides', () => {
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...CODES].sort());
    for (const code of CODES) {
      const message = ERROR_MESSAGES[code];
      expect(message.fr.trim().length).toBeGreaterThan(0);
      expect(message.en.trim().length).toBeGreaterThan(0);
      expect(message.fr).not.toContain('\n');
      expect(message.en).not.toContain('\n');
    }
  });

  it('errorMessage renvoie la langue demandée', () => {
    expect(errorMessage('INTERNAL_ERROR', 'fr')).toBe('Erreur interne');
    expect(errorMessage('INTERNAL_ERROR', 'en')).toBe('Internal error');
  });

  it.each([
    [undefined, 'fr'],
    ['', 'fr'],
    ['*', 'fr'],
    ['fr-CM,fr;q=0.9,en;q=0.8', 'fr'],
    ['en-GB,en;q=0.9', 'en'],
    ['EN', 'en'],
    ['de-DE,de;q=0.9,en;q=0.8', 'en'],
    ['de-DE', 'fr'],
  ] as const)('Accept-Language %j → %s', (header, locale) => {
    expect(problemLocaleFromHeader(header)).toBe(locale);
  });
});

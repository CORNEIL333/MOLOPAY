import { describe, expect, it } from 'vitest';
import { en } from './en';
import { fr } from './fr';
import { resolveLocale } from './index';

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix === '' ? key : `${prefix}.${key}`));
}

describe('NF-UX-002 portail partenaire en français et en anglais', () => {
  it('mêmes clés dans les deux langues, aucune valeur vide', () => {
    expect(keys(en).sort()).toEqual(keys(fr).sort());
    const empty = (value: unknown): boolean => typeof value === 'string' ? value.trim() === '' : typeof value === 'object' && value !== null && Object.values(value).some(empty);
    expect(empty(fr) || empty(en)).toBe(false);
  });

  it('langue : cookie explicite, puis navigateur par qualité, puis français', () => {
    expect(resolveLocale('en', 'fr-FR')).toBe('en');
    expect(resolveLocale('es', 'en-GB,en;q=0.8')).toBe('en');
    expect(resolveLocale(undefined, 'fr;q=0.4,en;q=0.9')).toBe('en');
    expect(resolveLocale(undefined, 'de;q=0.9,fr;q=0.8')).toBe('fr');
    expect(resolveLocale(undefined, null)).toBe('fr');
    expect(resolveLocale(undefined, '*')).toBe('fr');
  });
});

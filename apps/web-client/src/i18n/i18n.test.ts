import { describe, expect, it } from 'vitest';
import { getDictionary, resolveLocale } from './index';

describe('resolveLocale', () => {
  it('privilégie le choix explicite du cookie', () => {
    expect(resolveLocale('en', 'fr-FR,fr;q=0.9')).toBe('en');
    expect(resolveLocale('fr', 'en-US,en;q=0.9')).toBe('fr');
  });

  it('ignore un cookie inconnu et suit la langue du navigateur', () => {
    expect(resolveLocale('es', 'en-GB,en;q=0.8')).toBe('en');
    expect(resolveLocale(undefined, 'fr-CM,fr;q=0.9,en;q=0.4')).toBe('fr');
  });

  it('respecte les préférences de qualité', () => {
    expect(resolveLocale(undefined, 'fr;q=0.4,en;q=0.9')).toBe('en');
    expect(resolveLocale(undefined, 'de;q=0.9,fr;q=0.8')).toBe('fr');
  });

  it('revient au français sans en-tête exploitable', () => {
    expect(resolveLocale(undefined, null)).toBe('fr');
    expect(resolveLocale(undefined, '')).toBe('fr');
    expect(resolveLocale(undefined, '*')).toBe('fr');
  });
});

describe('dictionnaires', () => {
  it('expose les mêmes clés en français et en anglais', () => {
    const fr = getDictionary('fr');
    const en = getDictionary('en');
    expect(Object.keys(en)).toEqual(Object.keys(fr));
    expect(Object.keys(en.catalog.universes)).toEqual(
      Object.keys(fr.catalog.universes),
    );
    expect(Object.keys(en.goals.statuses)).toEqual(
      Object.keys(fr.goals.statuses),
    );
  });
});

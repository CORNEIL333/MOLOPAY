import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './safe-path';

describe('safeReturnPath', () => {
  it('accepte un chemin interne', () => {
    expect(safeReturnPath('/objectifs')).toBe('/objectifs');
    expect(safeReturnPath('/offres/abc?x=1')).toBe('/offres/abc?x=1');
  });

  it('refuse une redirection hors du site', () => {
    for (const value of [
      'https://exemple.test',
      '//exemple.test',
      '/\\exemple.test',
      'javascript:alert(1)',
      '',
      null,
      undefined,
    ]) {
      expect(safeReturnPath(value)).toBe('/');
    }
  });

  it('refuse un caractère de contrôle', () => {
    expect(safeReturnPath('/objectifs\u0000')).toBe('/');
    expect(safeReturnPath(`/${'a'.repeat(600)}`)).toBe('/');
  });
});

import { describe, expect, it } from 'vitest';
import { assertSupportedClient, isBelow, parseClientVersion, parseMinimumVersions } from './client-version';

describe('SEC-MOB-005 version minimale imposée par le serveur', () => {
  it('lecture de l’en-tête : plateforme et version ; absent : rien ; malformé : 400', () => {
    expect(parseClientVersion('mobile/1.12.3')).toEqual({ platform: 'mobile', version: [1, 12, 3] });
    expect(parseClientVersion(undefined)).toBeNull();
    for (const bad of ['mobile/1.2', 'ios/1.0.0', 'mobile/01.0.0', 'mobile/1.0.0-beta', ['mobile/1.0.0'], 'mobile/1.0.0 ']) {
      expect(() => parseClientVersion(bad), JSON.stringify(bad)).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }));
    }
  });

  it('comparaison numérique (1.10.0 > 1.9.9), égalité acceptée', () => {
    expect(isBelow([1, 9, 9], [1, 10, 0])).toBe(true);
    expect(isBelow([1, 10, 0], [1, 9, 9])).toBe(false);
    expect(isBelow([1, 2, 3], [1, 2, 3])).toBe(false);
    expect(isBelow([0, 9, 0], [1, 0, 0])).toBe(true);
  });

  it('minimum : en dessous → 426 CLIENT_UPGRADE_REQUIRED ; autre plateforme, navigateur ou paramètre absent : accepté', () => {
    const minimums = parseMinimumVersions({ mobile: '0.2.0' });
    expect(() => assertSupportedClient('mobile/0.1.9', minimums)).toThrow(expect.objectContaining({ code: 'CLIENT_UPGRADE_REQUIRED' }));
    expect(() => assertSupportedClient('mobile/0.2.0', minimums)).not.toThrow();
    expect(() => assertSupportedClient('desktop/0.0.1', minimums)).not.toThrow();
    expect(() => assertSupportedClient(undefined, minimums)).not.toThrow();
    expect(() => assertSupportedClient('mobile/0.0.1', parseMinimumVersions(undefined))).not.toThrow();
  });

  it('paramètre mal formé : ignoré en entier, jamais d’application bloquée par erreur de saisie', () => {
    for (const value of [{ mobile: '1.0' }, { mobile: 1 }, { ios: '1.0.0' }, ['mobile'], 'mobile/1.0.0', null]) {
      expect(parseMinimumVersions(value), JSON.stringify(value)).toEqual({});
    }
  });
});

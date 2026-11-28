import { describe, expect, it } from 'vitest';
import { findPotentialMatches, normalizeName } from './name-match';

const ENTRIES = [
  { reference: 'CDi.001', names: ['ERIC BADEGE'] },
  { reference: 'CDe.001', names: ['ADF', 'Allied Democratic Forces', 'Forces Démocratiques Alliées-Armée Nationale de Libération de l’Ouganda'] },
  { reference: 'CDe.002', names: ['BUTEMBO AIRLINES (BAL)'] },
];

describe('REG-LBC-002 / D66 rapprochement des noms', () => {
  it('normalisation : accents, casse, ponctuation, espaces', () => {
    expect(normalizeName('  Forces Démocratiques  Alliées-Armée ')).toBe('FORCES DEMOCRATIQUES ALLIEES ARMEE');
    expect(normalizeName('l’Ouganda')).toBe('L OUGANDA');
    expect(normalizeName('---')).toBe('');
  });

  it('même nom, ordre différent, accents ou casse : rapprochement', () => {
    expect(findPotentialMatches('badege eric', ENTRIES)).toEqual(['CDi.001']);
    expect(findPotentialMatches('ALLIED DEMOCRATIC FORCES', ENTRIES)).toEqual(['CDe.001']);
    expect(findPotentialMatches('forces democratiques alliees armee nationale de liberation de l ouganda', ENTRIES)).toEqual(['CDe.001']);
  });

  it('inclusion d’au moins deux mots : rapprochement (nom complet contenant le nom listé, ou l’inverse)', () => {
    expect(findPotentialMatches('Butembo Airlines SARL', ENTRIES)).toEqual(['CDe.002']);
    expect(findPotentialMatches('Eric Badege Junior', ENTRIES)).toEqual(['CDi.001']);
    expect(findPotentialMatches('Forces Democratiques Alliees', ENTRIES)).toEqual(['CDe.001']);
  });

  it('un seul mot commun ou un sigle seul : rapprochement seulement si égalité stricte', () => {
    expect(findPotentialMatches('ADF', ENTRIES)).toEqual(['CDe.001']);
    expect(findPotentialMatches('ADF Électronique', ENTRIES)).toEqual([]);
    expect(findPotentialMatches('Eric Mbarga', ENTRIES)).toEqual([]);
    expect(findPotentialMatches('Quincaillerie du Centre', ENTRIES)).toEqual([]);
  });

  it('nom vide après normalisation : refusé (jamais « aucun rapprochement » par défaut)', () => {
    expect(() => findPotentialMatches('---', ENTRIES)).toThrow();
  });

  it('I-1 caractères invisibles (format, ignorables) retirés avant comparaison : rapprochement maintenu', () => {
    expect(normalizeName('Er\u200Bic Bad\u00ADege')).toBe('ERIC BADEGE');
    expect(findPotentialMatches('Er\u200Bic Ba\u200Ddege', ENTRIES)).toEqual(['CDi.001']);
    expect(findPotentialMatches('E\u2060ric B\uFEFFadege', ENTRIES)).toEqual(['CDi.001']);
    expect(findPotentialMatches('Eric\u034F Badege', ENTRIES)).toEqual(['CDi.001']);
  });

  it('I-1 homoglyphes cyrilliques ou grecs ramenés aux lettres latines : rapprochement maintenu', () => {
    // « Е » cyrillique (U+0415), « і » ukrainien (U+0456), « а » cyrillique (U+0430), « Ε » grec (U+0395).
    expect(normalizeName('\u0415r\u0456c B\u0430dege')).toBe('ERIC BADEGE');
    expect(findPotentialMatches('\u0415r\u0456c B\u0430dege', ENTRIES)).toEqual(['CDi.001']);
    expect(findPotentialMatches('\u0395ric Badeg\u0435', ENTRIES)).toEqual(['CDi.001']);
    expect(findPotentialMatches('\u0410DF', ENTRIES)).toEqual(['CDe.001']);
  });
});

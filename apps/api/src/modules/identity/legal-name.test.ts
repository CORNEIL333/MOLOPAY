import { describe, expect, it } from 'vitest';
import { parseLegalName } from './legal-name.store';

function refused(value: unknown): string | undefined {
  try {
    parseLegalName(value);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe('REG-LBC-001 / D68 nom légal déclaré', () => {
  it('noms ordinaires acceptés, espaces normalisés', () => {
    expect(parseLegalName('  Aïcha   Ngono Mballa ')).toBe('Aïcha Ngono Mballa');
    expect(parseLegalName('Jean-Pierre N’Diaye')).toBe('Jean-Pierre N’Diaye');
    expect(parseLegalName('Иван Петров')).toBe('Иван Петров');
  });

  it('I-1 refuse les caractères de format ou invisibles (KYC_INVALID_REQUEST)', () => {
    expect(refused('Er\u200Bic Badege')).toBe('KYC_INVALID_REQUEST');
    expect(refused('Eric\u2060 Badege')).toBe('KYC_INVALID_REQUEST');
    expect(refused('Eric \uFEFFBadege')).toBe('KYC_INVALID_REQUEST');
    expect(refused('Eric Bad\u00ADege')).toBe('KYC_INVALID_REQUEST');
    expect(refused('Eric\u202E Badege')).toBe('KYC_INVALID_REQUEST');
    expect(refused('Eric\u034F Badege')).toBe('KYC_INVALID_REQUEST');
  });

  it('I-1 refuse le mélange d’écritures dans un même nom (homoglyphes) (KYC_INVALID_REQUEST)', () => {
    expect(refused('\u0415ric Badege')).toBe('KYC_INVALID_REQUEST');
    expect(refused('Eric B\u0430dege')).toBe('KYC_INVALID_REQUEST');
    expect(refused('\u0395ric Badege')).toBe('KYC_INVALID_REQUEST');
  });

  it('refuse type, longueur, contrôle et absence de lettre (KYC_INVALID_REQUEST)', () => {
    expect(refused(42)).toBe('KYC_INVALID_REQUEST');
    expect(refused('A')).toBe('KYC_INVALID_REQUEST');
    expect(refused('Eric\u0007Badege')).toBe('KYC_INVALID_REQUEST');
    expect(refused('12 34')).toBe('KYC_INVALID_REQUEST');
    expect(refused('A'.repeat(201))).toBe('KYC_INVALID_REQUEST');
  });

  it('IMP-2 refuse une marque diacritique hors des plages normalisées, comme la base (KYC_INVALID_REQUEST)', () => {
    expect(refused('Eric Bad\u0951ege')).toBe('KYC_INVALID_REQUEST');
    expect(refused('\u0645\u064F\u062D\u064E\u0645\u0651\u064E\u062F')).toBe('KYC_INVALID_REQUEST');
    expect(refused('Eric Bad\u0E31ege')).toBe('KYC_INVALID_REQUEST');
    expect(refused('Eric Bad@ege')).toBe('KYC_INVALID_REQUEST');
    expect(parseLegalName('Ëric Bâdège-N’Diaye, Jr.')).toBe('Ëric Bâdège-N’Diaye, Jr.');
    expect(parseLegalName('\u0645\u062D\u0645\u062F')).toBe('\u0645\u062D\u0645\u062F');
  });
});

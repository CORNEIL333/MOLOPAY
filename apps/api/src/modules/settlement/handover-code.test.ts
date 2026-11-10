import { randomBytes } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import {
  HANDOVER_CODE_PATTERN,
  formatHandoverCode,
  generateHandoverCode,
  handoverCodeMac,
  normalizeHandoverCode,
} from './handover-code';

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error: unknown) {
    return error instanceof BusinessError ? error.code : 'AUTRE';
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

describe('F-SAV-004 code de remise (D45)', () => {
  it('10 caractères Crockford, 10 000 tirages distincts', () => {
    const codes = Array.from({ length: 10_000 }, () => generateHandoverCode());
    for (const code of codes.slice(0, 200)) {
      expect(code).toMatch(HANDOVER_CODE_PATTERN);
    }
    expect(new Set(codes).size).toBe(10_000);
  });

  it('affichage en deux groupes, saisie tolérante (casse, espaces, tirets, I/L/O)', () => {
    expect(formatHandoverCode('ABCDE12345')).toBe('ABCDE-12345');
    expect(normalizeHandoverCode(' abcde-12345 ')).toBe('ABCDE12345');
    expect(normalizeHandoverCode('o1l1i-ABCDE')).toBe('01111ABCDE');
  });

  it('refuse une saisie de mauvaise forme (HANDOVER_CODE_INVALID)', () => {
    expect(codeOf(() => normalizeHandoverCode('ABC'))).toBe('HANDOVER_CODE_INVALID');
    expect(codeOf(() => normalizeHandoverCode('ABCDE1234U'))).toBe('HANDOVER_CODE_INVALID');
  });

  it('empreinte HMAC-SHA256 poivrée : dépend du poivre, jamais le code en clair', () => {
    const pepper = randomBytes(32);
    const mac = handoverCodeMac(pepper, 'ABCDE12345');
    expect(mac).toHaveLength(32);
    expect(mac.equals(handoverCodeMac(pepper, 'ABCDE12345'))).toBe(true);
    expect(mac.equals(handoverCodeMac(randomBytes(32), 'ABCDE12345'))).toBe(false);
    expect(mac.toString('utf8')).not.toContain('ABCDE12345');
  });

  it('refuse un poivre de moins de 32 octets (SETTLEMENT_INVALID_REQUEST)', () => {
    expect(codeOf(() => handoverCodeMac(randomBytes(16), 'ABCDE12345'))).toBe('SETTLEMENT_INVALID_REQUEST');
  });
});

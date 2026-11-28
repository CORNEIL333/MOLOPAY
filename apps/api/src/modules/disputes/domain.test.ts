import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import {
  COMPLAINT_CHANNELS,
  COMPLAINT_REFERENCE_PATTERN,
  generateComplaintReference,
  parseComplaintChannel,
} from './domain';

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof BusinessError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

describe('F-SUP-001 numéro de réclamation', () => {
  it('a la forme R- suivie de 10 caractères Crockford base32', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateComplaintReference()).toMatch(COMPLAINT_REFERENCE_PATTERN);
    }
    expect(COMPLAINT_REFERENCE_PATTERN.test('R-0123456789')).toBe(true);
    expect(COMPLAINT_REFERENCE_PATTERN.test('R-ILOU000000')).toBe(false);
  });

  it('AGENTS § 8 n’est pas séquentiel : 10 000 tirages distincts et non ordonnés', () => {
    const references = Array.from({ length: 10_000 }, () => generateComplaintReference());
    expect(new Set(references).size).toBe(10_000);
    const sorted = [...references].sort();
    expect(references).not.toEqual(sorted);
  });
});

describe('F-SUP-001 canaux de réclamation', () => {
  it('accepte application, rappel USSD et téléphone', () => {
    expect(COMPLAINT_CHANNELS).toEqual(['APP', 'USSD_CALLBACK', 'PHONE']);
    for (const channel of COMPLAINT_CHANNELS) {
      expect(parseComplaintChannel(channel)).toBe(channel);
    }
  });

  it('refuse un canal hors liste blanche (DISPUTE_INVALID_REQUEST)', () => {
    expect(codeOf(() => parseComplaintChannel('EMAIL'))).toBe('DISPUTE_INVALID_REQUEST');
  });
});

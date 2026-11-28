import { createHmac, randomBytes } from 'node:crypto';
import { BusinessError } from '@achat/contracts';

// Crockford base32 (sans I, L, O, U) : dictable, sans ambiguïté.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 10;
const MIN_PEPPER_BYTES = 32;
export const HANDOVER_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/**
 * F-SAV-004 / D45 : code de remise à usage unique, 50 bits aléatoires.
 * Montré une seule fois au client ; seule son empreinte est conservée.
 */
export function generateHandoverCode(): string {
  let code = '';
  for (const byte of randomBytes(CODE_LENGTH)) {
    code += CROCKFORD[byte & 31];
  }
  return code;
}

/** Affichage en deux groupes de cinq : « ABCDE-12345 ». */
export function formatHandoverCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * Saisie du vendeur : casse, espaces et tirets ignorés ; I et L lus 1, O lu 0
 * (règle Crockford). Toute autre forme est refusée.
 */
export function normalizeHandoverCode(input: string): string {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (!HANDOVER_CODE_PATTERN.test(code)) {
    throw new BusinessError('HANDOVER_CODE_INVALID', 'code de remise invalide');
  }
  return code;
}

/** Empreinte HMAC-SHA256 poivrée (le poivre vient de la configuration, jamais du code). */
export function handoverCodeMac(pepper: Uint8Array, code: string): Buffer {
  if (pepper.length < MIN_PEPPER_BYTES) {
    throw new BusinessError('SETTLEMENT_INVALID_REQUEST', 'poivre trop court');
  }
  return createHmac('sha256', pepper).update(code, 'utf8').digest();
}

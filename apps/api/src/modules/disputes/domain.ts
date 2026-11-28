import { randomBytes } from 'node:crypto';
import { BusinessError } from '@achat/contracts';

// F-SUP-001 : application, USSD (demande de rappel) ou téléphone.
export const COMPLAINT_CHANNELS = ['APP', 'USSD_CALLBACK', 'PHONE'] as const;
export type ComplaintChannel = (typeof COMPLAINT_CHANNELS)[number];

// Crockford base32 (sans I, L, O, U) : lisible au téléphone, sans ambiguïté.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const REFERENCE_LENGTH = 10;
export const COMPLAINT_REFERENCE_PATTERN = /^R-[0-9A-HJKMNP-TV-Z]{10}$/;

/**
 * Numéro de réclamation communiqué au client (F-SUP-001). Tiré au hasard
 * (50 bits) : jamais séquentiel, il ne révèle pas le volume de réclamations
 * (AGENTS.md § 8). L'unicité est imposée par la base.
 */
export function generateComplaintReference(): string {
  const bytes = randomBytes(REFERENCE_LENGTH);
  let reference = 'R-';
  for (const byte of bytes) {
    reference += CROCKFORD[byte & 31];
  }
  return reference;
}

export function parseComplaintChannel(value: string): ComplaintChannel {
  if (!(COMPLAINT_CHANNELS as readonly string[]).includes(value)) {
    throw new BusinessError('DISPUTE_INVALID_REQUEST', 'canal de réclamation non autorisé');
  }
  return value as ComplaintChannel;
}

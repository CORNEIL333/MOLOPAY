import { ChainError } from './errors';

export const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const ISO_UTC_MS_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function fail(code: 'CHAIN_INVALID_CONTENT' | 'STH_INVALID' | 'TIMESTAMP_INVALID', message: string): never {
  throw new ChainError(code, message);
}

export function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('CHAIN_INVALID_CONTENT', `${field} ne doit pas être vide`);
  }
}

export function assertUuidV7(value: string, field: string): void {
  if (!UUID_V7_PATTERN.test(value)) {
    fail('CHAIN_INVALID_CONTENT', `${field} doit être un UUID v7`);
  }
}

export function assertIsoUtcMs(value: string, field: string): void {
  if (!ISO_UTC_MS_PATTERN.test(value)) {
    fail(
      'CHAIN_INVALID_CONTENT',
      `${field} doit être un horodatage ISO 8601 UTC avec millisecondes`,
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    fail('CHAIN_INVALID_CONTENT', `${field} n’est pas une date valide`);
  }
}

export function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('CHAIN_INVALID_CONTENT', `${field} doit être un entier sûr >= 1`);
  }
}

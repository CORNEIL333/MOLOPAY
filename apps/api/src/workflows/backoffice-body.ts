import { BusinessError } from '@achat/contracts';

/** Corps en liste blanche (SEC-AUTHZ-002) : champs requis et optionnels exactement, sinon 400. */
export function whitelistedBody(body: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BusinessError('REQUEST_INVALID', 'Corps de requête invalide');
  }
  const value = body as Record<string, unknown>;
  const keys = Object.keys(value);
  if (!required.every((key) => keys.includes(key)) || !keys.every((key) => required.includes(key) || optional.includes(key))) {
    throw new BusinessError('REQUEST_INVALID', 'Champs non autorisés ou manquants');
  }
  return value;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new BusinessError('REQUEST_INVALID', 'Valeur non autorisée');
  }
  return value as T;
}

export function optionalText(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > 1000) {
    throw new BusinessError('REQUEST_INVALID', 'Texte invalide');
  }
  return value;
}

export function requiredText(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new BusinessError('REQUEST_INVALID', 'Valeur invalide');
  }
  return value;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const BANK_REFERENCE_PATTERN = /^[A-Za-z0-9._:/-]{1,100}$/;

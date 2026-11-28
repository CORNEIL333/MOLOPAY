import { blindIndex, decryptField, encryptField, piiKeyWrapperFromEnv, type KeyWrapper } from '../../crypto/envelope';
import { awsKmsKeyWrapper } from '../../crypto/aws-kms';
import { normalizePhone } from './domain';

/**
 * C14 / SEC-CRY-002 : protection du numéro de téléphone. L'application ne voit
 * le numéro qu'à l'entrée (demande de code, agence) ; la base ne reçoit que :
 * - l'empreinte à clé (clé d'index hors base) : unicité, liaison, quotas ;
 * - le numéro chiffré par enveloppe (AWS KMS), lié à son empreinte ;
 * - le numéro masqué pour l'affichage (indicatif + deux derniers chiffres).
 */
export const PII_KEYS = Symbol('PII_KEYS');

export type PiiKeys = { readonly wrapper: KeyWrapper; readonly phoneIndexKey: Uint8Array };

export type ProtectedPhone = { readonly key: string; readonly ciphertext: string; readonly masked: string };

export function maskPhone(e164: string): string {
  if (!/^\+[1-9][0-9]{7,14}$/.test(e164)) throw new Error('IDENTITY_PHONE_MASK_INVALID');
  const digits = e164.slice(1);
  return `+${digits.slice(0, 3)}${'•'.repeat(digits.length - 5)}${digits.slice(-2)}`;
}

export function phoneKey(raw: string, keys: PiiKeys): string {
  return blindIndex(normalizePhone(raw), keys.phoneIndexKey, 'phone');
}

const context = (key: string): { table: string; column: string; rowId: string } => ({ table: 'identity', column: 'phone', rowId: key });

export async function protectPhone(raw: string, keys: PiiKeys): Promise<ProtectedPhone> {
  const e164 = normalizePhone(raw);
  const key = blindIndex(e164, keys.phoneIndexKey, 'phone');
  return { key, ciphertext: await encryptField(e164, context(key), keys.wrapper), masked: maskPhone(e164) };
}

/** Numéro en clair, pour un envoi au client seulement (jamais journalisé). */
export function revealPhone(protectedPhone: { readonly key: string; readonly ciphertext: string }, keys: PiiKeys): Promise<string> {
  return decryptField(protectedPhone.ciphertext, context(protectedPhone.key), keys.wrapper);
}

/**
 * Configuration (fermée par défaut) : clé maîtresse (`PII_KMS_KEY_ARN`, ou
 * `PII_LOCAL_MASTER_KEY` hors production) et clé d'index emballée par elle
 * (`PHONE_INDEX_KEY_WRAPPED`, base64url), déballée une fois au démarrage.
 */
export async function piiKeysFromEnv(env: NodeJS.ProcessEnv): Promise<PiiKeys | null> {
  const wrapper = piiKeyWrapperFromEnv(env, (arn) => awsKmsKeyWrapper(arn));
  const wrapped = env['PHONE_INDEX_KEY_WRAPPED'];
  if (wrapper === null || wrapped === undefined || !/^[A-Za-z0-9_-]{40,2048}$/.test(wrapped)) return null;
  const phoneIndexKey = await wrapper.unwrap(Buffer.from(wrapped, 'base64url'));
  if (phoneIndexKey.length !== 32) throw new Error('PII_INDEX_KEY_INVALID');
  return { wrapper, phoneIndexKey };
}

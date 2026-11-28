import { createHash } from 'node:crypto';
import { localKeyWrapper } from '../../src/crypto/envelope';
import { protectPhone, type PiiKeys, type ProtectedPhone } from '../../src/modules/identity/phone-key';

/**
 * C14 : clés de test (clé maîtresse locale réelle, AES-256-GCM ; ce n'est pas
 * une imitation du KMS). Valeurs fixes et publiques : tests seulement.
 */
const seed = (label: string): Buffer => createHash('sha256').update(`molopay-test-${label}`).digest();

export const TEST_PII_KEYS: PiiKeys = { wrapper: localKeyWrapper(seed('master'), 'local-test'), phoneIndexKey: seed('phone-index') };

/** Empreinte, chiffré et masque d'un numéro, comme les écrit l'application. */
export function protectedPhone(e164: string): Promise<ProtectedPhone> {
  return protectPhone(e164, TEST_PII_KEYS);
}

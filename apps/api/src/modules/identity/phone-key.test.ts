import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { localKeyWrapper } from '../../crypto/envelope';
import { maskPhone, phoneKey, piiKeysFromEnv, protectPhone, revealPhone, type PiiKeys } from './phone-key';

const keys: PiiKeys = { wrapper: localKeyWrapper(randomBytes(32)), phoneIndexKey: randomBytes(32) };

describe('C14 protection du numéro de téléphone', () => {
  it('empreinte identique quelle que soit l’écriture du numéro ; chiffré lisible seulement avec son empreinte', async () => {
    const a = await protectPhone('+237 690 12 34 56', keys);
    expect(a.key).toBe(phoneKey('00237690123456', keys));
    expect(a.masked).toBe('+237•••••••56');
    expect(JSON.stringify(a)).not.toContain('690123456');
    expect(await revealPhone(a, keys)).toBe('+237690123456');
    const b = await protectPhone('+237690999999', keys);
    // Chiffré recopié sur une autre empreinte : refusé.
    await expect(revealPhone({ key: b.key, ciphertext: a.ciphertext }, keys)).rejects.toThrow('PII_DECRYPT_FAILED');
  });

  it('masque : indicatif et deux derniers chiffres seulement', () => {
    expect(maskPhone('+237690123456')).toBe('+237•••••••56');
    expect(() => maskPhone('690123456')).toThrow('IDENTITY_PHONE_MASK_INVALID');
  });

  it('configuration : sans clé d’index emballée, fermé ; clé d’index déballée par la clé maîtresse', async () => {
    expect(await piiKeysFromEnv({ PII_LOCAL_MASTER_KEY: 'a'.repeat(64) })).toBeNull();
    const master = localKeyWrapper(Buffer.from('a'.repeat(64), 'hex'));
    const index = randomBytes(32);
    const wrapped = Buffer.from(await master.wrap(index)).toString('base64url');
    const loaded = await piiKeysFromEnv({ PII_LOCAL_MASTER_KEY: 'a'.repeat(64), PHONE_INDEX_KEY_WRAPPED: wrapped });
    expect(Buffer.from(loaded?.phoneIndexKey ?? []).equals(index)).toBe(true);
    await expect(piiKeysFromEnv({ PII_LOCAL_MASTER_KEY: 'b'.repeat(64), PHONE_INDEX_KEY_WRAPPED: wrapped })).rejects.toThrow('PII_DECRYPT_FAILED');
  });
});

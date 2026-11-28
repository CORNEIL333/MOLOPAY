import { randomBytes } from 'node:crypto';
import { EncryptCommand, type DecryptCommand } from '@aws-sdk/client-kms';
import { describe, expect, it } from 'vitest';
import { awsKmsKeyWrapper } from './aws-kms';
import { blindIndex, decryptField, encryptField, localKeyWrapper, piiKeyWrapperFromEnv } from './envelope';

const wrapper = localKeyWrapper(randomBytes(32));
const CONTEXT = { table: 'identity.account', column: 'phone', rowId: '019ab900-0000-7000-8000-0000000000c1' };

describe('C14 / SEC-CRY-002 chiffrement applicatif par enveloppe', () => {
  it('aller-retour ; chiffré différent à chaque fois ; aucun clair dans le chiffré', async () => {
    const a = await encryptField('+237690123456', CONTEXT, wrapper);
    const b = await encryptField('+237690123456', CONTEXT, wrapper);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(a).not.toContain('690123456');
    expect(await decryptField(a, CONTEXT, wrapper)).toBe('+237690123456');
  });

  it('chiffré lié à sa table, sa colonne et sa ligne ; altération et autre clé maîtresse refusées', async () => {
    const sealed = await encryptField('+237690123456', CONTEXT, wrapper);
    for (const other of [{ ...CONTEXT, rowId: 'autre' }, { ...CONTEXT, column: 'phone2' }, { ...CONTEXT, table: 'identity.other' }]) {
      await expect(decryptField(sealed, other, wrapper)).rejects.toThrow('PII_DECRYPT_FAILED');
    }
    const parts = sealed.split('.');
    const body = Buffer.from(parts[3] ?? '', 'base64url');
    body[0] = (body[0] ?? 0) ^ 1;
    await expect(decryptField([parts[0], parts[1], parts[2], body.toString('base64url')].join('.'), CONTEXT, wrapper)).rejects.toThrow('PII_DECRYPT_FAILED');
    await expect(decryptField(sealed, CONTEXT, localKeyWrapper(randomBytes(32)))).rejects.toThrow('PII_DECRYPT_FAILED');
    await expect(decryptField('v2.a.b.c', CONTEXT, wrapper)).rejects.toThrow('PII_FORMAT_INVALID');
  });

  it('empreinte à clé : déterministe, dépend de la clé et de l’usage, n’expose pas la valeur', () => {
    const key = randomBytes(32);
    expect(blindIndex('+237690123456', key, 'phone')).toBe(blindIndex('+237690123456', key, 'phone'));
    expect(blindIndex('+237690123456', key, 'phone')).not.toBe(blindIndex('+237690123456', randomBytes(32), 'phone'));
    expect(blindIndex('+237690123456', key, 'phone')).not.toBe(blindIndex('+237690123456', key, 'otp'));
    expect(blindIndex('+237690123456', key, 'phone')).toMatch(/^[0-9a-f]{64}$/);
    expect(() => blindIndex('x', randomBytes(16), 'phone')).toThrow('PII_INDEX_KEY_INVALID');
  });

  it('configuration : KMS en priorité ; clé locale refusée en production ; rien : fermé', () => {
    const kms = (arn: string): ReturnType<typeof localKeyWrapper> => ({ keyId: arn, wrap: () => Promise.reject(new Error('x')), unwrap: () => Promise.reject(new Error('x')) });
    expect(piiKeyWrapperFromEnv({ PII_KMS_KEY_ARN: 'arn:aws:kms:eu-central-1:123456789012:key/abc', PII_LOCAL_MASTER_KEY: 'a'.repeat(64) }, kms)?.keyId).toContain('arn:aws:kms');
    expect(piiKeyWrapperFromEnv({ PII_LOCAL_MASTER_KEY: 'a'.repeat(64) }, kms)?.keyId).toBe('local');
    expect(() => piiKeyWrapperFromEnv({ PII_LOCAL_MASTER_KEY: 'a'.repeat(64), NODE_ENV: 'production' }, kms)).toThrow('PII_LOCAL_KEY_FORBIDDEN_IN_PRODUCTION');
    expect(() => piiKeyWrapperFromEnv({ PII_LOCAL_MASTER_KEY: 'court' }, kms)).toThrow('PII_MASTER_KEY_INVALID');
    expect(piiKeyWrapperFromEnv({}, kms)).toBeNull();
  });

  it('AWS KMS : Encrypt/Decrypt avec la clé imposée et le contexte d’usage fixe', async () => {
    const arn = 'arn:aws:kms:eu-central-1:123456789012:key/0b5f2a4e-1111-4222-8333-444455556666';
    const sent: (EncryptCommand | DecryptCommand)[] = [];
    const kms = awsKmsKeyWrapper(arn, (command) => {
      sent.push(command);
      return Promise.resolve(command instanceof EncryptCommand ? { CiphertextBlob: new Uint8Array([9, 9]) } : { Plaintext: new Uint8Array(32) });
    });
    await kms.wrap(new Uint8Array(32));
    await kms.unwrap(new Uint8Array([9, 9]));
    expect(sent[0]?.input).toMatchObject({ KeyId: arn, EncryptionContext: { purpose: 'molopay-pii-dek-v1' } });
    expect(sent[1]?.input).toMatchObject({ KeyId: arn, EncryptionContext: { purpose: 'molopay-pii-dek-v1' } });
    expect(() => awsKmsKeyWrapper('arn:aws:kms:eu-central-1:1:key/x')).toThrow('PII_KMS_KEY_INVALID');
  });
});

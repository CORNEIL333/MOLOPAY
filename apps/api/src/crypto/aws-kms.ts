import { DecryptCommand, EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import type { KeyWrapper } from './envelope';

/**
 * ADR-0004 / D5 : emballage des clés de données par AWS KMS (Francfort).
 * `Encrypt` / `Decrypt` avec un contexte de chiffrement fixe : une clé emballée
 * pour un autre usage ne se déballe pas. La clé maîtresse ne quitte jamais le
 * HSM ; les identifiants AWS viennent de l'environnement d'exécution (rôle de
 * la machine), jamais du dépôt.
 */
export type KmsSend = (command: EncryptCommand | DecryptCommand) => Promise<{ CiphertextBlob?: Uint8Array | undefined; Plaintext?: Uint8Array | undefined }>;

/** Contexte de chiffrement KMS par usage : une clé de données n'est désemballée que pour l'usage qui l'a emballée. */
export const KMS_PURPOSES = ['molopay-pii-dek-v1', 'molopay-backup-dek-v1'] as const;
export type KmsPurpose = (typeof KMS_PURPOSES)[number];
const KEY_ARN = /^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:(key\/[0-9a-f-]{36}|alias\/[A-Za-z0-9/_-]{1,250})$/;

export function awsKmsKeyWrapper(keyArn: string, send?: KmsSend, purpose: KmsPurpose = 'molopay-pii-dek-v1'): KeyWrapper {
  if (!KEY_ARN.test(keyArn)) throw new Error('PII_KMS_KEY_INVALID');
  if (!(KMS_PURPOSES as readonly string[]).includes(purpose)) throw new Error('PII_KMS_PURPOSE_INVALID');
  const CONTEXT = { purpose };
  const region = keyArn.split(':')[3] ?? '';
  const client = send === undefined ? new KMSClient({ region }) : null;
  const call: KmsSend = send ?? (async (command) => {
    const output = command instanceof EncryptCommand ? await client?.send(command) : await client?.send(command);
    if (output === undefined) throw new Error('PII_KMS_FAILED');
    return output;
  });
  return {
    keyId: keyArn,
    async wrap(dataKey) {
      const result = await call(new EncryptCommand({ KeyId: keyArn, Plaintext: dataKey, EncryptionContext: { ...CONTEXT } }));
      if (result.CiphertextBlob === undefined) throw new Error('PII_KMS_FAILED');
      return result.CiphertextBlob;
    },
    async unwrap(wrapped) {
      // KeyId imposé : KMS refuse un chiffré produit par une autre clé maîtresse.
      const result = await call(new DecryptCommand({ KeyId: keyArn, CiphertextBlob: wrapped, EncryptionContext: { ...CONTEXT } }));
      if (result.Plaintext === undefined) throw new Error('PII_KMS_FAILED');
      return result.Plaintext;
    },
  };
}

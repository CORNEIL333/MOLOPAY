import { createPublicKey, type KeyObject } from 'node:crypto';
import { DecryptCommand, EncryptCommand, GetPublicKeyCommand, KMSClient, SignCommand } from '@aws-sdk/client-kms';
import type { KeyWrapper } from './envelope';
import { assertSignableInstruction, checkedSignature, KEY_ARN as SIGNING_KEY_ARN, unavailable, type InstructionSigner } from './instruction-signer';

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

type KmsSignResponse = {
  readonly KeyId?: string | undefined;
  readonly KeySpec?: string | undefined;
  readonly KeyUsage?: string | undefined;
  readonly SigningAlgorithms?: readonly string[] | undefined;
  readonly PublicKey?: Uint8Array | undefined;
  readonly Signature?: Uint8Array | undefined;
};
export type KmsSignSend = (command: GetPublicKeyCommand | SignCommand) => Promise<KmsSignResponse>;

const RESOLVED_KEY_ARN = /^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[0-9a-f-]{36}$/;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('SIGNING_TIMEOUT')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Signataire AWS KMS. Au démarrage : lecture de la clé publique, refus si la
 * clé n'est pas une clé Ed25519 de signature. À chaque signature :
 * `Sign` (ED25519_SHA_512, message brut), délai borné, signature revérifiée.
 * Aucune erreur du fournisseur n'est recopiée (ni ARN, ni détail).
 */
export async function awsKmsInstructionSigner(keyArn: string, send?: KmsSignSend, timeoutMs = 5000): Promise<InstructionSigner> {
  if (!SIGNING_KEY_ARN.test(keyArn)) throw new Error('SIGNING_KMS_KEY_INVALID');
  const client = send === undefined ? new KMSClient({ region: keyArn.split(':')[3] ?? '' }) : null;
  const call: KmsSignSend = send ?? (async (command) => {
    if (client === null) throw new Error('SIGNING_KMS_CLIENT_MISSING');
    const signal = AbortSignal.timeout(timeoutMs);
    return command instanceof SignCommand ? client.send(command, { abortSignal: signal }) : client.send(command, { abortSignal: signal });
  });
  let description: KmsSignResponse;
  try {
    description = await withTimeout(call(new GetPublicKeyCommand({ KeyId: keyArn })), timeoutMs);
  } catch (error) {
    throw new Error('SIGNING_KMS_UNREACHABLE', { cause: error });
  }
  const resolved = description.KeyId ?? '';
  if (
    !RESOLVED_KEY_ARN.test(resolved)
    || description.KeySpec !== 'ECC_NIST_EDWARDS25519'
    || description.KeyUsage !== 'SIGN_VERIFY'
    || description.SigningAlgorithms?.includes('ED25519_SHA_512') !== true
    || description.PublicKey === undefined
  ) {
    throw new Error('SIGNING_KMS_KEY_INVALID');
  }
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey({ key: Buffer.from(description.PublicKey), format: 'der', type: 'spki' });
  } catch {
    throw new Error('SIGNING_KMS_KEY_INVALID');
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('SIGNING_KMS_KEY_INVALID');
  return Object.freeze({
    // ARN résolu de la clé (jamais un alias) : identifie sans ambiguïté la clé de vérification.
    keyId: resolved,
    publicKey,
    async sign(message: Buffer): Promise<Buffer> {
      assertSignableInstruction(message);
      let result: KmsSignResponse;
      try {
        result = await withTimeout(
          call(new SignCommand({ KeyId: resolved, Message: new Uint8Array(message), MessageType: 'RAW', SigningAlgorithm: 'ED25519_SHA_512' })),
          timeoutMs,
        );
      } catch {
        unavailable();
      }
      if (result.KeyId !== resolved) unavailable();
      return checkedSignature(publicKey, message, result.Signature);
    },
  });
}


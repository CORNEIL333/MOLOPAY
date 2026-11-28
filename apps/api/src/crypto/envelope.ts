import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * C14 / SEC-CRY-002 (ADR-0004, 25 novembre) : chiffrement applicatif par
 * enveloppe des champs sensibles avant leur entrée en base (Neon chiffre au
 * repos avec ses propres clés). Chaque valeur a sa propre clé de données
 * (AES-256-GCM, 256 bits, aléa de 96 bits), elle-même emballée par la clé
 * maîtresse (AWS KMS en production). Les données authentifiées associées lient
 * le chiffré à sa table, sa colonne et sa ligne : un chiffré recopié ailleurs
 * ne se déchiffre pas. Format texte : `v1.<clé emballée>.<aléa>.<chiffré+étiquette>`
 * (base64url).
 */
export type KeyWrapper = {
  /** Identifiant de la clé maîtresse (journalisable, non secret). */
  readonly keyId: string;
  wrap(dataKey: Uint8Array): Promise<Uint8Array>;
  unwrap(wrapped: Uint8Array): Promise<Uint8Array>;
};

export type FieldContext = { readonly table: string; readonly column: string; readonly rowId: string };

const PREFIX = 'v1';
const NAME = /^[a-z_][a-z0-9_.]{0,62}$/;

function aad(context: FieldContext): Buffer {
  if (!NAME.test(context.table) || !NAME.test(context.column) || context.rowId.length === 0 || context.rowId.length > 100) {
    throw new Error('PII_CONTEXT_INVALID');
  }
  return Buffer.from(`molopay.pii.v1\u0000${context.table}\u0000${context.column}\u0000${context.rowId}`, 'utf8');
}

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

export async function encryptField(plaintext: string, context: FieldContext, wrapper: KeyWrapper): Promise<string> {
  const dataKey = randomBytes(32);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
    cipher.setAAD(aad(context));
    const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return [PREFIX, b64(await wrapper.wrap(dataKey)), b64(iv), b64(sealed)].join('.');
  } finally {
    dataKey.fill(0);
  }
}

export async function decryptField(serialized: string, context: FieldContext, wrapper: KeyWrapper): Promise<string> {
  const parts = serialized.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error('PII_FORMAT_INVALID');
  const [, wrapped, ivText, sealedText] = parts as [string, string, string, string];
  const iv = Buffer.from(ivText, 'base64url');
  const sealed = Buffer.from(sealedText, 'base64url');
  if (iv.length !== 12 || sealed.length < 17) throw new Error('PII_FORMAT_INVALID');
  const dataKey = Buffer.from(await wrapper.unwrap(Buffer.from(wrapped, 'base64url')));
  try {
    if (dataKey.length !== 32) throw new Error('PII_KEY_INVALID');
    const decipher = createDecipheriv('aes-256-gcm', dataKey, iv);
    decipher.setAAD(aad(context));
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    try {
      return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('PII_DECRYPT_FAILED');
    }
  } finally {
    dataKey.fill(0);
  }
}

/**
 * Empreinte à clé (HMAC-SHA-256) pour l'unicité et la recherche sans
 * déchiffrer : déterministe, inutilisable sans la clé d'index (distincte de
 * la clé maîtresse, elle-même emballée par le KMS).
 */
export function blindIndex(value: string, indexKey: Uint8Array, purpose: string): string {
  if (indexKey.length !== 32) throw new Error('PII_INDEX_KEY_INVALID');
  return createHmac('sha256', indexKey).update(`molopay.index.v1\u0000${purpose}\u0000${value}`, 'utf8').digest('hex');
}

/**
 * Emballage local par une clé de 256 bits (AES-256-GCM) : développement,
 * tests et environnements sans KMS. Ce n'est pas une imitation du KMS : c'est
 * une autre clé maîtresse, refusée en production par `piiKeyWrapperFromEnv`.
 */
export function localKeyWrapper(masterKey: Uint8Array, keyId = 'local'): KeyWrapper {
  if (masterKey.length !== 32) throw new Error('PII_MASTER_KEY_INVALID');
  const key = Buffer.from(masterKey);
  const context = Buffer.from('molopay.dek.v1', 'utf8');
  return {
    keyId,
    async wrap(dataKey) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(context);
      return Promise.resolve(Buffer.concat([iv, cipher.update(dataKey), cipher.final(), cipher.getAuthTag()]));
    },
    async unwrap(wrapped) {
      const bytes = Buffer.from(wrapped);
      if (bytes.length !== 12 + 32 + 16) throw new Error('PII_FORMAT_INVALID');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(context);
      decipher.setAuthTag(bytes.subarray(bytes.length - 16));
      try {
        return Promise.resolve(Buffer.concat([decipher.update(bytes.subarray(12, bytes.length - 16)), decipher.final()]));
      } catch {
        throw new Error('PII_DECRYPT_FAILED');
      }
    },
  };
}

/**
 * Configuration : `PII_KMS_KEY_ARN` (production) ; sinon `PII_LOCAL_MASTER_KEY`
 * (64 hexadécimaux), refusée si `NODE_ENV=production`. Rien : `null` (fermé
 * par défaut, aucune donnée sensible ne peut être écrite).
 */
export function piiKeyWrapperFromEnv(env: NodeJS.ProcessEnv, kms: (arn: string) => KeyWrapper): KeyWrapper | null {
  const arn = env['PII_KMS_KEY_ARN'];
  if (arn !== undefined && arn !== '') return kms(arn);
  const local = env['PII_LOCAL_MASTER_KEY'];
  if (local === undefined || local === '') return null;
  if (env['NODE_ENV'] === 'production') throw new Error('PII_LOCAL_KEY_FORBIDDEN_IN_PRODUCTION');
  if (!/^[0-9a-f]{64}$/.test(local)) throw new Error('PII_MASTER_KEY_INVALID');
  return localKeyWrapper(Buffer.from(local, 'hex'));
}

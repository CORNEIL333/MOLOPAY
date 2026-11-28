import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { canonicalize } from '@achat/chain';
import { BusinessError } from '@achat/contracts';

/**
 * D5 (ADR-0004, 24 novembre : clés en KMS/HSM managé, non exportables ; « le
 * message signé ne contiendra aucune donnée personnelle, à imposer dans
 * l'adaptateur de signature ») : signataire des instructions de sortie de
 * fonds (remboursement, règlement partenaire, virement au bénéficiaire C).
 *
 * - Format inchangé : Ed25519 pur sur les octets canoniques (JCS) du document ;
 *   la vérification existante (`verify(null, …)`) et le vérificateur restent
 *   valables, quel que soit le signataire.
 * - Seuls les trois documents d'instruction connus, sous forme canonique
 *   exacte, avec des identifiants UUID et des montants entiers, sont signés :
 *   aucune donnée personnelle ni valeur libre ne peut atteindre la clé.
 * - Chaque signature est revérifiée avec la clé publique avant d'être rendue.
 * - Production : AWS KMS uniquement (`awsKmsInstructionSigner`, `aws-kms.ts`). Aucune clé
 *   privée n'est chargée depuis l'environnement ; le signataire local ne sert
 *   qu'aux tests. Sans configuration, la signature reste fermée (503).
 */
export type InstructionSigner = {
  readonly keyId: string;
  readonly publicKey: KeyObject;
  sign(message: Buffer): Promise<Buffer>;
};

const KEY_ID_PATTERN = /^[^\s]{1,100}$/;
export const KEY_ARN = /^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:(key\/[0-9a-f-]{36}|alias\/[A-Za-z0-9/_-]{1,250})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AMOUNT = /^(0|[1-9][0-9]{0,17})$/;
/**
 * Code opaque de partenaire ou de bénéficiaire, même forme que la base
 * (0011, 0057) ; une suite de 8 chiffres ou plus (forme d'un numéro de
 * téléphone) est refusée, par prudence.
 */
const CODE = /^(?![\s\S]*[0-9]{8})[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
/** KMS refuse un message brut de plus de 4 096 octets. */
const MAX_MESSAGE_BYTES = 4096;
const SIGNATURE_BYTES = 64;

/** Champs autorisés par domaine (identifiants opaques et montant entier seulement). */
const DOCUMENTS: Readonly<Record<string, Readonly<Record<string, RegExp>>>> = {
  'payout-instruction-v1': { payout_id: UUID, partner_id: CODE, net_xaf: AMOUNT },
  'refund-instruction-v1': { refund_id: UUID, customer_id: UUID, amount_xaf: AMOUNT },
  'beneficiary-payout-instruction-v1': { payout_id: UUID, beneficiary_id: CODE, amount_xaf: AMOUNT },
};

function forbidden(): never {
  throw new Error('SIGNING_DOCUMENT_FORBIDDEN');
}

/** Liste blanche : le message est exactement la forme canonique d'un document d'instruction connu. */
export function assertSignableInstruction(message: Buffer): void {
  // Borne avant toute analyse (un message vide ou hors forme échoue plus bas).
  if (message.length > MAX_MESSAGE_BYTES) forbidden();
  let parsed: unknown;
  try {
    parsed = JSON.parse(message.toString('utf8'));
  } catch {
    forbidden();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) forbidden();
  const document = parsed as Record<string, unknown>;
  const domain = document['domain'];
  const fields = typeof domain === 'string' && Object.hasOwn(DOCUMENTS, domain) ? DOCUMENTS[domain] : undefined;
  if (fields === undefined) forbidden();
  const keys = Object.keys(document);
  if (keys.length !== Object.keys(fields).length + 1) forbidden();
  for (const [name, pattern] of Object.entries(fields)) {
    const value = document[name];
    if (typeof value !== 'string' || !pattern.test(value)) forbidden();
  }
  // Octet pour octet la forme canonique : ni espace, ni ordre, ni échappement différents.
  if (!Buffer.from(canonicalize(document as Record<string, string>), 'utf8').equals(message)) forbidden();
}

export function unavailable(): never {
  throw new BusinessError('SIGNING_UNAVAILABLE', 'Service de signature des instructions indisponible');
}

export function checkedSignature(publicKey: KeyObject, message: Buffer, signature: Uint8Array | undefined): Buffer {
  if (signature?.length !== SIGNATURE_BYTES) unavailable();
  const result = Buffer.from(signature);
  if (!verify(null, message, publicKey, result)) unavailable();
  return result;
}

/** Signataire à clé locale : tests et développement uniquement (jamais construit depuis l'environnement). */
export function localInstructionSigner(privateKey: KeyObject, keyId: string): InstructionSigner {
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519' || !KEY_ID_PATTERN.test(keyId)) {
    throw new Error('SIGNING_KEY_INVALID');
  }
  const publicKey = createPublicKey(privateKey);
  return Object.freeze({
    keyId,
    publicKey,
    sign(message: Buffer): Promise<Buffer> {
      try {
        assertSignableInstruction(message);
        return Promise.resolve(checkedSignature(publicKey, message, sign(null, message, privateKey)));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error('SIGNING_FAILED'));
      }
    },
  });
}

/**
 * `INSTRUCTION_SIGNING_KMS_KEY_ARN` : ARN de la clé KMS de signature, distincte
 * des clés de chiffrement (données personnelles, copies). Absente : null.
 */
export function instructionSigningArnFromEnv(env: NodeJS.ProcessEnv): string | null {
  const arn = env['INSTRUCTION_SIGNING_KMS_KEY_ARN']?.trim() ?? '';
  if (arn === '') return null;
  if (!KEY_ARN.test(arn)) throw new Error('SIGNING_KMS_KEY_INVALID');
  for (const name of ['PII_KMS_KEY_ARN', 'BACKUP_KMS_KEY_ARN']) {
    if (env[name]?.trim() === arn) throw new Error('SIGNING_KEY_NOT_DISTINCT');
  }
  return arn;
}

/** Démarrage : signataire KMS si configuré, sinon null (routes de sortie de fonds fermées). */
export async function instructionSignerFromEnv(env: NodeJS.ProcessEnv, kms: (arn: string) => Promise<InstructionSigner>): Promise<InstructionSigner | null> {
  const arn = instructionSigningArnFromEnv(env);
  return arn === null ? null : kms(arn);
}

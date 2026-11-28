import { generateKeyPairSync, verify, type KeyObject } from 'node:crypto';
import { GetPublicKeyCommand, SignCommand } from '@aws-sdk/client-kms';
import { canonicalize } from '@achat/chain';
import { describe, expect, it } from 'vitest';
import {
  assertSignableInstruction,
  instructionSigningArnFromEnv,
  localInstructionSigner,
} from './instruction-signer';
import { awsKmsInstructionSigner, type KmsSignSend } from './aws-kms';

/**
 * D5 (ADR-0004 : clés en KMS/HSM managé, non exportables ; le message signé ne
 * contient aucune donnée personnelle, imposé par l'adaptateur) : signature des
 * instructions de sortie de fonds derrière une interface asynchrone, sans
 * changer le format des documents ni leur vérification (Ed25519 pur).
 */
const ARN = 'arn:aws:kms:eu-central-1:123456789012:key/11111111-2222-4333-8444-555555555555';
const OTHER_ARN = 'arn:aws:kms:eu-central-1:123456789012:key/99999999-2222-4333-8444-555555555555';
const UUID_A = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const UUID_B = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

const bytes = (document: Record<string, string>): Buffer => Buffer.from(canonicalize({ ...document }), 'utf8');
const REFUND = bytes({ domain: 'refund-instruction-v1', refund_id: UUID_A, customer_id: UUID_B, amount_xaf: '25000' });
const PAYOUT = bytes({ domain: 'payout-instruction-v1', payout_id: UUID_A, partner_id: 'merchant-1', net_xaf: '0' });
const BENEFICIARY = bytes({ domain: 'beneficiary-payout-instruction-v1', payout_id: UUID_A, beneficiary_id: 'school_2026-7', amount_xaf: '150000' });

/** Faux point d'appel KMS piloté par une vraie clé Ed25519 : il ne remplace que le transport. */
function kmsBackedBy(options: { readonly keySpec?: string; readonly keyUsage?: string; readonly algorithms?: string[]; readonly signer?: 'same' | 'other' | 'truncated' | 'none'; readonly keyIdReturned?: string; readonly describedKeyId?: string; readonly publicKey?: KeyObject; readonly hang?: boolean } = {}): { readonly pair: { readonly publicKey: KeyObject; readonly privateKey: KeyObject }; readonly send: KmsSignSend; readonly calls: Array<GetPublicKeyCommand | SignCommand> } {
  const pair = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');
  const calls: Array<GetPublicKeyCommand | SignCommand> = [];
  const send: KmsSignSend = async (command) => {
    calls.push(command);
    if (command instanceof GetPublicKeyCommand) {
      return {
        KeyId: options.describedKeyId ?? ARN,
        KeySpec: options.keySpec ?? 'ECC_NIST_EDWARDS25519',
        KeyUsage: options.keyUsage ?? 'SIGN_VERIFY',
        SigningAlgorithms: options.algorithms ?? ['ED25519_SHA_512', 'ED25519_PH_SHA_512'],
        PublicKey: new Uint8Array((options.publicKey ?? pair.publicKey).export({ format: 'der', type: 'spki' })),
      };
    }
    if (options.hang === true) return new Promise(() => undefined);
    const message = Buffer.from(command.input.Message ?? new Uint8Array());
    const mode = options.signer ?? 'same';
    if (mode === 'none') return { KeyId: ARN };
    const signature = (await import('node:crypto')).sign(null, message, mode === 'other' ? other.privateKey : pair.privateKey);
    return { KeyId: options.keyIdReturned ?? ARN, Signature: new Uint8Array(mode === 'truncated' ? signature.subarray(0, 63) : signature) };
  };
  return { pair, send, calls };
}

describe('D5 — document signable : aucune donnée personnelle, format figé', () => {
  it('accepte exactement les trois documents d’instruction canoniques', () => {
    for (const document of [REFUND, PAYOUT, BENEFICIARY]) expect(() => assertSignableInstruction(document)).not.toThrow();
    // Bornes acceptées : code de 100 caractères, 7 chiffres consécutifs, montant de 18 chiffres.
    expect(() => assertSignableInstruction(bytes({ domain: 'payout-instruction-v1', payout_id: UUID_A, partner_id: 'x'.repeat(100), net_xaf: '999999999999999999' }))).not.toThrow();
    expect(() => assertSignableInstruction(bytes({ domain: 'payout-instruction-v1', payout_id: UUID_A, partner_id: 'm1234567', net_xaf: '1' }))).not.toThrow();
  });

  it('refuse (SIGNING_DOCUMENT_FORBIDDEN) : domaine inconnu, champ en trop ou absent, valeur libre, forme non canonique', () => {
    const forbidden = [
      bytes({ domain: 'refund-instruction-v2', refund_id: UUID_A, customer_id: UUID_B, amount_xaf: '1' }),
      bytes({ domain: 'refund-instruction-v1', refund_id: UUID_A, customer_id: UUID_B, amount_xaf: '1', phone: '+237690000000' }),
      bytes({ domain: 'refund-instruction-v1', refund_id: UUID_A, amount_xaf: '1' }),
      bytes({ domain: 'refund-instruction-v1', refund_id: UUID_A, customer_id: 'Jean Dupont', amount_xaf: '1' }),
      bytes({ domain: 'refund-instruction-v1', refund_id: UUID_A, customer_id: UUID_B, amount_xaf: '01' }),
      bytes({ domain: 'refund-instruction-v1', refund_id: UUID_A, customer_id: UUID_B, amount_xaf: '-5' }),
      bytes({ domain: 'refund-instruction-v1', refund_id: UUID_A, customer_id: UUID_B, amount_xaf: '1.5' }),
      bytes({ domain: 'payout-instruction-v1', payout_id: UUID_A, beneficiary_id: UUID_B, net_xaf: '1' }),
      bytes({ domain: 'payout-instruction-v1', payout_id: UUID_A, partner_id: '237690000000', net_xaf: '1' }),
      bytes({ domain: 'payout-instruction-v1', payout_id: UUID_A, partner_id: 'm-69000000', net_xaf: '1' }),
      bytes({ domain: 'payout-instruction-v1', payout_id: UUID_A, partner_id: 'Boutique Awa', net_xaf: '1' }),
      bytes({ domain: 'payout-instruction-v1', payout_id: UUID_A, partner_id: '-merchant', net_xaf: '1' }),
      bytes({ domain: 'payout-instruction-v1', payout_id: UUID_A, partner_id: 'x'.repeat(101), net_xaf: '1' }),
      bytes({ domain: 'beneficiary-payout-instruction-v1', payout_id: UUID_A, beneficiary_id: 'awa@example.cm', amount_xaf: '1' }),
      bytes({ domain: 'payout-instruction-v1', payout_id: 'merchant-1', partner_id: 'merchant-1', net_xaf: '1' }),
      bytes({ domain: 'beneficiary-payout-instruction-v1', payout_id: UUID_A, beneficiary_id: UUID_B, net_xaf: '1' }),
      Buffer.from(`{"amount_xaf":"1","customer_id":"${UUID_B}","domain":"refund-instruction-v1", "refund_id":"${UUID_A}"}`),
      Buffer.from(`{"domain":"refund-instruction-v1","refund_id":"${UUID_A}","customer_id":"${UUID_B}","amount_xaf":"1"}`),
      Buffer.from('pas du json'),
      Buffer.from('["refund-instruction-v1"]'),
      Buffer.from(`{"amount_xaf":1,"customer_id":"${UUID_B}","domain":"refund-instruction-v1","refund_id":"${UUID_A}"}`),
      Buffer.from(`{"amount_xaf":"1","customer_id":"${UUID_B.toUpperCase()}","domain":"refund-instruction-v1","refund_id":"${UUID_A}"}`),
      Buffer.from(`{"amount_xaf":"1","customer_id":"${UUID_B}","domain":"refund-instruction-v1","refund_id":"${UUID_A}"}\n`),
      Buffer.alloc(5000, 0x20),
      // Clés héritées du prototype : jamais prises pour un domaine connu.
      Buffer.from('{"domain":"constructor"}'),
      Buffer.from('{"domain":"toString"}'),
      Buffer.from('{"domain":"__proto__"}'),
      Buffer.from('null'),
      Buffer.from('"refund-instruction-v1"'),
      Buffer.from('42'),
      Buffer.alloc(0),
    ];
    for (const document of forbidden) expect(() => assertSignableInstruction(document), document.toString('utf8').slice(0, 80)).toThrow(/^SIGNING_DOCUMENT_FORBIDDEN$/);
  });
});

describe('D5 — signataire local (tests et développement uniquement)', () => {
  it('signe en Ed25519 pur, vérifiable comme avant ; expose son identifiant de clé', async () => {
    const pair = generateKeyPairSync('ed25519');
    const signer = localInstructionSigner(pair.privateKey, 'plateforme-test-1');
    expect(signer.keyId).toBe('plateforme-test-1');
    const signature = await signer.sign(REFUND);
    expect(signature).toHaveLength(64);
    expect(verify(null, REFUND, pair.publicKey, signature)).toBe(true);
    expect(signer.publicKey.export({ format: 'der', type: 'spki' }).equals(pair.publicKey.export({ format: 'der', type: 'spki' }))).toBe(true);
  });

  it('refuse : clé autre qu’Ed25519 privée, identifiant de clé invalide, document interdit', async () => {
    expect(() => localInstructionSigner(generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey, 'k1')).toThrow(/^SIGNING_KEY_INVALID$/);
    expect(() => localInstructionSigner(generateKeyPairSync('ed25519').publicKey, 'k1')).toThrow(/^SIGNING_KEY_INVALID$/);
    const pair = generateKeyPairSync('ed25519');
    for (const keyId of ['', 'avec espace', 'x'.repeat(101)]) expect(() => localInstructionSigner(pair.privateKey, keyId)).toThrow(/^SIGNING_KEY_INVALID$/);
    expect(() => localInstructionSigner(pair.privateKey, 'x'.repeat(100))).not.toThrow();
    await expect(localInstructionSigner(pair.privateKey, 'k1').sign(Buffer.from('{"domain":"autre"}'))).rejects.toThrow(/^SIGNING_DOCUMENT_FORBIDDEN$/);
  });
});

describe('D5 — signataire AWS KMS (ECC_NIST_EDWARDS25519, ED25519_SHA_512, message brut)', () => {
  it('lit la clé publique au démarrage puis signe par KMS ; la signature se vérifie avec la clé publique de KMS', async () => {
    const kms = kmsBackedBy();
    const signer = await awsKmsInstructionSigner(ARN, kms.send);
    expect(signer.keyId).toBe(ARN);
    const signature = await signer.sign(PAYOUT);
    expect(verify(null, PAYOUT, kms.pair.publicKey, signature)).toBe(true);
    expect(signature).toHaveLength(64);
    const [lookup, signing] = kms.calls;
    expect(lookup).toBeInstanceOf(GetPublicKeyCommand);
    expect(lookup?.input).toEqual({ KeyId: ARN });
    expect(signing).toBeInstanceOf(SignCommand);
    expect((signing as SignCommand).input).toEqual({ KeyId: ARN, Message: new Uint8Array(PAYOUT), MessageType: 'RAW', SigningAlgorithm: 'ED25519_SHA_512' });
  });

  it('refuse au démarrage (SIGNING_KMS_KEY_INVALID) : ARN mal formé, mauvais type de clé, mauvais usage, algorithme absent', async () => {
    await expect(awsKmsInstructionSigner('arn:aws:kms:eu-central-1:123:key/x', kmsBackedBy().send)).rejects.toThrow(/^SIGNING_KMS_KEY_INVALID$/);
    await expect(awsKmsInstructionSigner(ARN, kmsBackedBy({ keySpec: 'ECC_NIST_P256' }).send)).rejects.toThrow(/^SIGNING_KMS_KEY_INVALID$/);
    await expect(awsKmsInstructionSigner(ARN, kmsBackedBy({ keyUsage: 'ENCRYPT_DECRYPT' }).send)).rejects.toThrow(/^SIGNING_KMS_KEY_INVALID$/);
    await expect(awsKmsInstructionSigner(ARN, kmsBackedBy({ algorithms: ['ED25519_PH_SHA_512'] }).send)).rejects.toThrow(/^SIGNING_KMS_KEY_INVALID$/);
    // KMS doit répondre par l'ARN résolu d'une clé (jamais un alias ni une valeur libre).
    await expect(awsKmsInstructionSigner(ARN, kmsBackedBy({ describedKeyId: 'arn:aws:kms:eu-central-1:123456789012:alias/molopay-signing' }).send)).rejects.toThrow(/^SIGNING_KMS_KEY_INVALID$/);
    await expect(awsKmsInstructionSigner(ARN, kmsBackedBy({ describedKeyId: 'n’importe quoi' }).send)).rejects.toThrow(/^SIGNING_KMS_KEY_INVALID$/);
    // Clé publique annoncée Ed25519 mais d'un autre type : refusée.
    await expect(awsKmsInstructionSigner(ARN, kmsBackedBy({ publicKey: generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey }).send)).rejects.toThrow(/^SIGNING_KMS_KEY_INVALID$/);
  });

  it('refuse à la signature (SIGNING_UNAVAILABLE, aucune signature rendue) : signature fausse, tronquée, absente, autre clé, délai dépassé', async () => {
    for (const signer of ['other', 'truncated', 'none'] as const) {
      const kms = kmsBackedBy({ signer });
      await expect((await awsKmsInstructionSigner(ARN, kms.send)).sign(REFUND)).rejects.toMatchObject({ code: 'SIGNING_UNAVAILABLE' });
    }
    await expect((await awsKmsInstructionSigner(ARN, kmsBackedBy({ keyIdReturned: OTHER_ARN }).send)).sign(REFUND)).rejects.toMatchObject({ code: 'SIGNING_UNAVAILABLE' });
    await expect((await awsKmsInstructionSigner(ARN, kmsBackedBy({ hang: true }).send, 50)).sign(REFUND)).rejects.toMatchObject({ code: 'SIGNING_UNAVAILABLE' });
    const failing: KmsSignSend = async (command) => {
      if (command instanceof GetPublicKeyCommand) return kmsBackedBy().send(command);
      throw new Error('AccessDeniedException: arn secret détaillé');
    };
    const error = await (await awsKmsInstructionSigner(ARN, failing)).sign(REFUND).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'SIGNING_UNAVAILABLE' });
    expect(String((error as Error).message)).not.toContain('AccessDenied');
  });

  it('configuré par alias : la clé est résolue au démarrage ; signature et identifiant portent l’ARN de la clé, jamais l’alias', async () => {
    const alias = 'arn:aws:kms:eu-central-1:123456789012:alias/molopay-signing';
    const kms = kmsBackedBy();
    const signer = await awsKmsInstructionSigner(alias, kms.send);
    expect(signer.keyId).toBe(ARN);
    await signer.sign(BENEFICIARY);
    expect(kms.calls[0]?.input).toEqual({ KeyId: alias });
    expect(kms.calls[1]?.input).toMatchObject({ KeyId: ARN });
  });

  it('refuse un document interdit sans appeler KMS', async () => {
    const kms = kmsBackedBy();
    const signer = await awsKmsInstructionSigner(ARN, kms.send);
    await expect(signer.sign(Buffer.from('{"domain":"autre"}'))).rejects.toThrow(/^SIGNING_DOCUMENT_FORBIDDEN$/);
    expect(kms.calls.filter((call) => call instanceof SignCommand)).toHaveLength(0);
  });
});

describe('D5 — configuration : KMS seulement, fermé sans configuration', () => {
  it('absente : null (routes de sortie de fonds en 503 SIGNING_UNCONFIGURED)', () => {
    expect(instructionSigningArnFromEnv({})).toBeNull();
    expect(instructionSigningArnFromEnv({ INSTRUCTION_SIGNING_KMS_KEY_ARN: '  ' })).toBeNull();
  });

  it('présente : ARN valide, distinct des clés de chiffrement', () => {
    expect(instructionSigningArnFromEnv({ INSTRUCTION_SIGNING_KMS_KEY_ARN: ARN })).toBe(ARN);
    expect(() => instructionSigningArnFromEnv({ INSTRUCTION_SIGNING_KMS_KEY_ARN: 'cle-locale' })).toThrow(/^SIGNING_KMS_KEY_INVALID$/);
    expect(() => instructionSigningArnFromEnv({ INSTRUCTION_SIGNING_KMS_KEY_ARN: ARN, PII_KMS_KEY_ARN: ARN })).toThrow(/^SIGNING_KEY_NOT_DISTINCT$/);
    expect(() => instructionSigningArnFromEnv({ INSTRUCTION_SIGNING_KMS_KEY_ARN: ARN, BACKUP_KMS_KEY_ARN: ARN })).toThrow(/^SIGNING_KEY_NOT_DISTINCT$/);
  });
});

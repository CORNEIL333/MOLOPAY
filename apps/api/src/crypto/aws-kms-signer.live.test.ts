import { verify } from 'node:crypto';
import { canonicalize } from '@achat/chain';
import { describe, expect, it } from 'vitest';
import { awsKmsInstructionSigner } from './aws-kms';

/**
 * D5 : signature réelle par AWS KMS (clé ECC_NIST_EDWARDS25519 de test).
 * Exige INSTRUCTION_SIGNING_KMS_TEST_KEY_ARN et des identifiants AWS fournis
 * par l'environnement (jamais dans le dépôt). Données synthétiques uniquement.
 */
describe('D5 AWS KMS réel — signature Ed25519 des instructions', () => {
  it('signe une instruction de règlement ; la signature se vérifie en Ed25519 pur avec la clé publique de KMS', async () => {
    const arn = process.env['INSTRUCTION_SIGNING_KMS_TEST_KEY_ARN'];
    if (arn === undefined) throw new Error('INSTRUCTION_SIGNING_KMS_TEST_KEY_ARN absent : identifiants de test AWS à fournir');
    const signer = await awsKmsInstructionSigner(arn);
    const message = Buffer.from(canonicalize({ domain: 'payout-instruction-v1', payout_id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', partner_id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c', net_xaf: '1000' }), 'utf8');
    const signature = await signer.sign(message);
    expect(signature).toHaveLength(64);
    expect(verify(null, message, signer.publicKey, signature)).toBe(true);
  });
});

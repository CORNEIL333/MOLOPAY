import { describe, expect, it } from 'vitest';
import { awsKmsKeyWrapper } from './aws-kms';
import { decryptField, encryptField } from './envelope';

/**
 * ADR-0004 / D5 : aller-retour réel avec AWS KMS. Exige PII_KMS_TEST_KEY_ARN
 * et des identifiants AWS fournis par l'environnement (jamais dans le dépôt).
 */
describe('C14 AWS KMS réel', () => {
  it('chiffre et déchiffre un champ avec une clé de données emballée par KMS', async () => {
    const arn = process.env['PII_KMS_TEST_KEY_ARN'];
    if (arn === undefined) throw new Error('PII_KMS_TEST_KEY_ARN absent : identifiants de test AWS à fournir');
    const wrapper = awsKmsKeyWrapper(arn);
    const context = { table: 'identity.account', column: 'phone', rowId: 'test-live' };
    expect(await decryptField(await encryptField('+237690000000', context, wrapper), context, wrapper)).toBe('+237690000000');
  });
});

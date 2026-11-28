import type { PoolClient } from 'pg';
import { BusinessError } from '@achat/contracts';
import { issueSignupOtp } from './client-auth.store';
import type { ProtectedPhone } from './phone-key';

type SqlClient = Pick<PoolClient, 'query'>;

export type AgencyDocumentType = 'CNI' | 'PASSPORT' | 'RESIDENCE_PERMIT';

/**
 * C13 : code d'inscription émis en agence après vérification en personne de
 * l'identité et du téléphone. Même code et mêmes règles que par SMS ; le code
 * est rendu une seule fois à l'agent, qui le remet au client. Un numéro déjà
 * inscrit est signalé à l'agent (aucun code émis).
 */
export async function issueAgencySignupCode(
  client: SqlClient,
  input: { readonly phone: ProtectedPhone; readonly pepper: Uint8Array; readonly staffId: string; readonly cityId: string; readonly documentType: AgencyDocumentType },
): Promise<{ readonly challengeId: string; readonly code: string; readonly expiresAt: string }> {
  const existing = await client.query('SELECT 1 FROM identity.account WHERE phone = $1', [input.phone.key]);
  if (existing.rowCount !== 0) {
    throw new BusinessError('IDENTITY_ACCOUNT_EXISTS', 'Un compte existe déjà pour ce numéro');
  }
  const issued = await issueSignupOtp(client, { phone: input.phone, pepper: input.pepper });
  await client.query(
    'INSERT INTO identity.agency_enrollment (challenge_id, staff_id, city_id, document_type, issued_at) VALUES ($1, $2, $3, $4, now())',
    [issued.challengeId, input.staffId, input.cityId, input.documentType],
  );
  return Object.freeze({ challengeId: issued.challengeId, code: issued.code, expiresAt: issued.expiresAt });
}

import type { PoolClient } from 'pg';
import { insertLegalNameDeclaration, parseLegalName } from '../modules/identity/legal-name.store';
import { grantBasicLevel, linkLegalNameScreening, screenName } from '../modules/kyc/sanctions.store';
import { uuidv7 } from '../modules/ledger/domain';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * REG-LBC-001 / REG-LBC-002 / F-ACC-003 (D68) : le client déclare son nom
 * légal ; dans la même transaction, le nom est filtré contre la liste ONU la
 * plus récente, le filtrage est rattaché à la déclaration, puis l'élévation
 * au niveau 1 est tentée par la base. Sans liste importée : tout est refusé.
 */
export async function declareLegalNameAndScreen(
  client: SqlClient,
  input: { readonly accountId: string; readonly legalName: string },
): Promise<{ readonly screeningId: string; readonly outcome: 'CLEAR' | 'POTENTIAL_MATCH'; readonly kycLevel: string }> {
  const legalName = parseLegalName(input.legalName);
  const declarationId = uuidv7();
  await insertLegalNameDeclaration(client, { id: declarationId, accountId: input.accountId, legalName });
  const screening = await screenName(client, { screeningId: uuidv7(), subjectType: 'CUSTOMER', subjectId: input.accountId, name: legalName, actorId: 'kyc-self-declaration' });
  await linkLegalNameScreening(client, { declarationId, screeningId: screening.screeningId });
  const kycLevel = await grantBasicLevel(client, input.accountId);
  return Object.freeze({ screeningId: screening.screeningId, outcome: screening.outcome, kycLevel });
}

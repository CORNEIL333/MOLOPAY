import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { getAgreement } from '../modules/agreements/agreement.store';
import { issueHandoverCode } from '../modules/settlement/handover.store';
import { factKey, notifyCustomer } from './notify';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * F-SAV-004 + F-NOT-001 : émet le code de remise et écrit HANDOVER_READY dans
 * la même transaction. Le code en clair n'est jamais mis dans la notification.
 */
export async function issueHandoverCodeAndNotify(
  client: SqlClient,
  input: { readonly agreementId: string; readonly pepper: Uint8Array; readonly actorId: string },
): Promise<{ readonly code: string; readonly expiresAt: string }> {
  const stored = await getAgreement(client, input.agreementId);
  if (stored === null) {
    throw new BusinessError('AGREEMENT_NOT_FOUND', 'Accord introuvable');
  }
  const issued = await issueHandoverCode(client, input);
  await notifyCustomer(client, {
    customerId: stored.agreement.terms.customerId,
    event: 'HANDOVER_READY',
    eventKey: factKey('handover-ready', input.agreementId, issued.expiresAt),
  });
  return issued;
}

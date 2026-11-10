import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { getPartnerLedgerOwner } from '../modules/catalog/partner-ledger.store';
import { confirmHandover } from '../modules/settlement/handover.store';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * F-SET-001 au point de remise : lit l'identifiant comptable du marchand
 * dans le catalogue (D42) puis confirme la remise dans le module settlement,
 * qui ne dépend pas du catalogue (CDC_05 § 3). À appeler dans une transaction.
 */
export async function confirmHandoverAtPartner(
  client: SqlClient,
  input: {
    readonly code: string;
    readonly partnerId: string;
    readonly partnerUserId: string;
    readonly latitude: string;
    readonly longitude: string;
    readonly pepper: Uint8Array;
  },
): Promise<{ readonly agreementId: string; readonly entryId: string }> {
  const owner = await getPartnerLedgerOwner(client, input.partnerId);
  if (owner === null) {
    throw new BusinessError('HANDOVER_CODE_INVALID', 'code de remise invalide');
  }
  return confirmHandover(client, { ...input, partnerLedgerOwnerId: owner });
}

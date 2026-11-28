import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { appendAuditEvent } from '../audit/audit.store';
import { recordMerchantDefault, type MerchantDefault } from '../catalog/partner.store';
import { appendAgreementTransition } from './agreement.store';

// Un Client ou un PoolClient suffit : seule `query` est utilisée.
type SqlClient = Pick<PoolClient, 'query'>;

export type MerchantDefaultDeclaration = {
  readonly incident: MerchantDefault;
  /** Accords gelés dans la même transaction, à notifier aux clients. */
  readonly frozenAgreementIds: readonly string[];
};

/**
 * Déclare une défaillance marchand (F-SAV-006, décision D31) dans la
 * transaction de l'appelant : incident au registre, gel immédiat des accords A
 * actifs du marchand pour arrêter les versements, puis événement d'audit.
 * Tout réussit ou rien. L'autorisation (`DECLARE_MERCHANT_DEFAULT`, motif,
 * périmètre partenaire) est vérifiée par l'appelant via le module admin.
 * Les accords FUNDED ne sont pas gelés (CDC_05 § 5.2 ne le permet pas) : ils
 * restent listés pour un remède (lot 12).
 */
export async function declareMerchantDefault(
  client: SqlClient,
  input: {
    readonly incidentId: string;
    readonly partnerId: string;
    readonly reason: string;
    readonly actorId: string;
  },
): Promise<MerchantDefaultDeclaration> {
  const incident = await recordMerchantDefault(client, {
    id: input.incidentId,
    partnerId: input.partnerId,
    reason: input.reason,
    reportedBy: input.actorId,
  });
  const active = await client.query<{ id: string }>(
    `SELECT id FROM agreements.agreement_state
     WHERE model = 'SAVE_THEN_BUY' AND partner_id = $1 AND status = 'ACTIVE'
     ORDER BY id`,
    [input.partnerId],
  );
  const frozenAgreementIds: string[] = [];
  for (const row of active.rows) {
    const frozen = await appendAgreementTransition(client, {
      agreementId: row.id,
      to: 'FROZEN',
      actorId: input.actorId,
    });
    if (frozen.agreement.status !== 'FROZEN') {
      throw new BusinessError('AGREEMENT_INVALID_REQUEST', 'Gel non appliqué');
    }
    frozenAgreementIds.push(row.id);
  }
  await appendAuditEvent(client, {
    eventType: 'CATALOG_ACTION',
    actorId: input.actorId,
    action: 'MERCHANT_DEFAULT_DECLARED',
    targetType: 'PARTNER',
    targetId: input.partnerId,
    outcome: 'SUCCESS',
    reason: incident.reason,
    refs: {
      incident_id: incident.id,
      frozen_agreements: frozenAgreementIds.length.toString(),
    },
  });
  return { incident, frozenAgreementIds };
}

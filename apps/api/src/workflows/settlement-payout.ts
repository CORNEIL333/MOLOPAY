import type { KeyObject } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { getAgreement } from '../modules/agreements/agreement.store';
import { getPartnerLedgerOwner } from '../modules/catalog/partner-ledger.store';
import { getCurrentOffer } from '../modules/catalog/offer.store';
import {
  insertExecution,
  insertInstruction,
  type PayoutInstructionDocument,
} from '../modules/settlement/execution.store';
import { getPayout, insertPayout, insertPayoutDecision, type Payout } from '../modules/settlement/payout.store';

type SqlClient = Pick<PoolClient, 'query'>;

/** La ville déclarée doit être servie par l'offre de l'accord (périmètre des agents). */
async function assertCityOfAgreement(client: SqlClient, agreementId: string, cityId: string): Promise<void> {
  const stored = await getAgreement(client, agreementId);
  const offerId = stored?.agreement.terms.offerId ?? null;
  const offer = offerId === null ? null : await getCurrentOffer(client, offerId);
  if (offer === null || !(offer.offer.cityIds as readonly string[]).includes(cityId)) {
    throw new BusinessError('ADMIN_SCOPE_DENIED', 'Ville hors de l’offre de l’accord');
  }
}

/** F-SET-002 : préparation par un agent autorisé (PREPARE_SETTLEMENT, ville). */
export async function preparePayout(
  client: SqlClient,
  input: { readonly id: string; readonly agreementId: string; readonly cityId: string; readonly principal: AdminPrincipal },
): Promise<Payout> {
  assertAuthorized(input.principal, 'PREPARE_SETTLEMENT', { cityId: input.cityId });
  await assertCityOfAgreement(client, input.agreementId, input.cityId);
  return insertPayout(client, { id: input.id, agreementId: input.agreementId, actorId: input.principal.actorId });
}

/** F-SET-003 : décision par un approbateur distinct (APPROVE_SETTLEMENT, ville, plafond). */
export async function decidePayout(
  client: SqlClient,
  input: {
    readonly payoutId: string;
    readonly principal: AdminPrincipal;
    readonly decision: 'APPROVED' | 'REJECTED';
    readonly reason?: string | undefined;
    readonly cityId: string;
  },
): Promise<{ readonly status: 'APPROVED' | 'REJECTED'; readonly commissionEntryId: string | null }> {
  const payout = await getPayout(client, input.payoutId);
  if (payout === null) {
    throw new BusinessError('SETTLEMENT_NOT_FOUND', 'règlement introuvable');
  }
  assertAuthorized(input.principal, 'APPROVE_SETTLEMENT', { cityId: input.cityId, amountXaf: payout.grossXaf });
  await assertCityOfAgreement(client, payout.agreementId, input.cityId);
  const owner = await getPartnerLedgerOwner(client, payout.partnerId);
  if (owner === null) {
    throw new BusinessError('SETTLEMENT_INVALID_REQUEST', 'partenaire sans identifiant comptable');
  }
  return insertPayoutDecision(client, {
    payout,
    actorId: input.principal.actorId,
    decision: input.decision,
    reason: input.reason,
    partnerLedgerOwnerId: owner,
  });
}

async function payoutWithOwner(client: SqlClient, payoutId: string): Promise<{ payout: Payout; owner: string }> {
  const payout = await getPayout(client, payoutId);
  if (payout === null) {
    throw new BusinessError('SETTLEMENT_NOT_FOUND', 'règlement introuvable');
  }
  const owner = await getPartnerLedgerOwner(client, payout.partnerId);
  if (owner === null) {
    throw new BusinessError('SETTLEMENT_INVALID_REQUEST', 'partenaire sans identifiant comptable');
  }
  return { payout, owner };
}

/** F-SET-004 : émission de l'instruction signée par un agent APPROVE_SETTLEMENT. */
export async function instructPayout(
  client: SqlClient,
  input: {
    readonly payoutId: string;
    readonly principal: AdminPrincipal;
    readonly cityId: string;
    readonly signingKey: KeyObject;
    readonly keyId: string;
  },
): Promise<{ readonly document: PayoutInstructionDocument; readonly signature: Buffer }> {
  const { payout } = await payoutWithOwner(client, input.payoutId);
  assertAuthorized(input.principal, 'APPROVE_SETTLEMENT', { cityId: input.cityId, amountXaf: payout.grossXaf });
  await assertCityOfAgreement(client, payout.agreementId, input.cityId);
  return insertInstruction(client, {
    payout,
    actorId: input.principal.actorId,
    signingKey: input.signingKey,
    keyId: input.keyId,
  });
}

/** F-SET-004 : enregistrement de l'exécution rapportée par l'établissement (autre personne). */
export async function recordPayoutExecution(
  client: SqlClient,
  input: {
    readonly payoutId: string;
    readonly principal: AdminPrincipal;
    readonly cityId: string;
    readonly outcome: 'EXECUTED' | 'REJECTED';
    readonly bankReference: string;
  },
): Promise<{ readonly entryId: string | null }> {
  const { payout, owner } = await payoutWithOwner(client, input.payoutId);
  assertAuthorized(input.principal, 'APPROVE_SETTLEMENT', { cityId: input.cityId, amountXaf: payout.grossXaf });
  await assertCityOfAgreement(client, payout.agreementId, input.cityId);
  return insertExecution(client, {
    payout,
    actorId: input.principal.actorId,
    outcome: input.outcome,
    bankReference: input.bankReference,
    partnerLedgerOwnerId: owner,
  });
}

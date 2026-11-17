import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { getLatestPartnerLegalName } from '../modules/catalog/partner.store';
import { getScreeningStatus, recordScreeningReview, screenName, type Screening } from '../modules/kyc/sanctions.store';
import { uuidv7 } from '../modules/ledger/domain';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * REG-LBC-002 / D66 : filtre la raison sociale du dossier le plus récent
 * d'un partenaire contre la liste consolidée ONU la plus récente. Réservé
 * au Réseau partenaires et à la Conformité (`SCREEN_PARTNER`).
 */
export async function screenPartner(client: SqlClient, input: { readonly principal: AdminPrincipal; readonly partnerId: string }): Promise<Screening> {
  assertAuthorized(input.principal, 'SCREEN_PARTNER', {});
  const legalName = await getLatestPartnerLegalName(client, input.partnerId);
  if (legalName === null) {
    throw new BusinessError('KYC_SUBJECT_NOT_FOUND', 'partenaire introuvable');
  }
  return screenName(client, { screeningId: uuidv7(), subjectType: 'PARTNER', subjectId: input.partnerId, name: legalName, actorId: input.principal.actorId });
}

/** Examen motivé d'un rapprochement par la Conformité ; l'auteur du filtrage est refusé par la base (I-7). */
export async function reviewSanctionsMatch(
  client: SqlClient,
  input: { readonly principal: AdminPrincipal; readonly screeningId: string; readonly decision: 'FALSE_POSITIVE' | 'CONFIRMED_MATCH'; readonly reason: string },
): Promise<void> {
  assertAuthorized(input.principal, 'REVIEW_SANCTIONS_MATCH', { reason: input.reason });
  await recordScreeningReview(client, { screeningId: input.screeningId, decision: input.decision, reason: input.reason, actorId: input.principal.actorId });
}

/** État de filtrage d'un partenaire (lecture, mêmes droits que le filtrage). */
export async function partnerScreeningStatus(client: SqlClient, input: { readonly principal: AdminPrincipal; readonly partnerId: string }): Promise<ReturnType<typeof getScreeningStatus>> {
  assertAuthorized(input.principal, 'SCREEN_PARTNER', {});
  return getScreeningStatus(client, { subjectType: 'PARTNER', subjectId: input.partnerId });
}

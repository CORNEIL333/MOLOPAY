import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { getLatestPartnerLegalName } from '../modules/catalog/partner.store';
import { appendAuditEvent } from '../modules/audit/audit.store';
import { getScreeningDetail, getScreeningStatus, getScreeningSubject, type ScreeningDetail, grantBasicLevel, recordScreeningReview, screenName, type Screening } from '../modules/kyc/sanctions.store';
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
  // D68 : un faux positif écarté peut débloquer le niveau 1 d'un client (vérifié par la base).
  const subject = await getScreeningSubject(client, input.screeningId);
  if (subject?.subjectType === 'CUSTOMER' && input.decision === 'FALSE_POSITIVE') {
    await grantBasicLevel(client, subject.subjectId);
  }
}

/** État de filtrage d'un partenaire (lecture, mêmes droits que le filtrage). */
export async function partnerScreeningStatus(client: SqlClient, input: { readonly principal: AdminPrincipal; readonly partnerId: string }): Promise<ReturnType<typeof getScreeningStatus>> {
  assertAuthorized(input.principal, 'SCREEN_PARTNER', {});
  return getScreeningStatus(client, { subjectType: 'PARTNER', subjectId: input.partnerId });
}

/**
 * D74 / F-BO-004 : détail d'un filtrage pour l'examen (nom filtré, entrées
 * de liste rapprochées). Donnée d'identité : droit `READ_IDENTITY_DOCUMENT`
 * (Conformité, support N2), motif obligatoire, consultation inscrite à
 * l'audit chaîné (identifiant du client en référence pour un client).
 */
export async function readScreeningDetail(
  client: SqlClient,
  input: { readonly principal: AdminPrincipal; readonly screeningId: string; readonly reason: string },
): Promise<ScreeningDetail> {
  assertAuthorized(input.principal, 'READ_IDENTITY_DOCUMENT', { reason: input.reason });
  const detail = await getScreeningDetail(client, input.screeningId);
  if (detail === null) {
    throw new BusinessError('KYC_SUBJECT_NOT_FOUND', 'filtrage introuvable');
  }
  await appendAuditEvent(client, {
    eventType: 'SENSITIVE_DATA_READ',
    actorId: input.principal.actorId,
    action: 'READ_IDENTITY_DOCUMENT',
    targetType: 'SANCTIONS_SCREENING',
    targetId: input.screeningId,
    outcome: 'SUCCESS',
    reason: input.reason,
    ...(detail.subjectType === 'CUSTOMER' ? { refs: { client_id: detail.subjectId } } : {}),
  });
  return detail;
}

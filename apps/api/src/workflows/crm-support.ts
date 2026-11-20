import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { appendAuditEvent } from '../modules/audit/audit.store';
import { listInteractions, listTasks, type CrmInteraction, type CrmTask } from '../modules/crm/crm.store';
import { maskPhone } from '../modules/identity/profile.store';

type SqlClient = Pick<PoolClient, 'query'>;

const CRM_WRITER_ROLES: ReadonlySet<string> = new Set(['SUPPORT_N1', 'SUPPORT_N2']);
const AGREEMENT_LIMIT = 10;

export type CrmAgreementSummary = {
  readonly agreementId: string;
  readonly model: string;
  readonly status: string;
  readonly targetXaf: string;
  readonly createdAt: string;
};

/** Fiche client 360° vue par le support : identité masquée, accords, CRM. */
export type CrmCustomerFile = {
  readonly accountId: string;
  readonly phoneMasked: string;
  readonly memberSince: string;
  readonly legalNameDeclared: boolean;
  readonly agreements: readonly CrmAgreementSummary[];
  readonly interactions: readonly CrmInteraction[];
  readonly tasks: readonly CrmTask[];
};

/**
 * F-SUP-001 / F-BO-004 : fiche client 360° lue par le support. Consultation
 * motivée, inscrite à l'audit chaîné dans la même transaction avec
 * l'identifiant du client. Le numéro n'est renvoyé que masqué ; aucune pièce
 * d'identité, aucun nom légal.
 */
export async function readCrmCustomer(
  client: SqlClient,
  input: { readonly accountId: string; readonly principal: AdminPrincipal; readonly reason: string },
): Promise<CrmCustomerFile> {
  assertAuthorized(input.principal, 'READ_FINANCIAL_HISTORY', { reason: input.reason });
  const account = (await client.query<{ phone: string; created_at: Date; declared: boolean }>(
    `SELECT a.phone, a.created_at,
            EXISTS (SELECT 1 FROM identity.legal_name_declaration d WHERE d.account_id = a.id) AS declared
       FROM identity.account a WHERE a.id = $1`,
    [input.accountId],
  )).rows[0];
  if (account === undefined) {
    throw new BusinessError('IDENTITY_ACCOUNT_NOT_FOUND', 'Compte client inconnu');
  }
  await appendAuditEvent(client, {
    eventType: 'SENSITIVE_DATA_READ',
    actorId: input.principal.actorId,
    action: 'READ_FINANCIAL_HISTORY',
    targetType: 'CUSTOMER_ACCOUNT',
    targetId: input.accountId,
    outcome: 'SUCCESS',
    reason: input.reason,
    refs: { client_id: input.accountId },
  });
  const agreements = (await client.query<{ id: string; model: string; status: string; target_xaf: string; created_at: Date }>(
    `SELECT s.id, s.model, s.status, s.target_xaf::text AS target_xaf, s.created_at
       FROM agreements.agreement_state s
      WHERE s.customer_id = $1
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT $2`,
    [input.accountId, AGREEMENT_LIMIT],
  )).rows.map((row) => Object.freeze({
    agreementId: row.id,
    model: row.model,
    status: row.status,
    targetXaf: row.target_xaf,
    createdAt: row.created_at.toISOString(),
  }));
  return Object.freeze({
    accountId: input.accountId,
    phoneMasked: maskPhone(account.phone),
    memberSince: account.created_at.toISOString(),
    legalNameDeclared: account.declared,
    agreements,
    interactions: await listInteractions(client, input.accountId),
    tasks: await listTasks(client, input.accountId),
  });
}

/**
 * Écriture du registre CRM réservée au support (N1, N2). Les rôles sont
 * vérifiés côté serveur ; la trace de l'auteur est portée par le journal CRM
 * en ajout seul lui-même (aucune donnée recopiée dans l'audit).
 */
export function assertCrmWriter(principal: AdminPrincipal): void {
  if (!principal.roles.some((role) => CRM_WRITER_ROLES.has(role))) {
    throw new BusinessError('ADMIN_FORBIDDEN', 'Rôle insuffisant pour le registre CRM');
  }
}

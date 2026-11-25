import { Body, Controller, Header, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CurrentStaff, StaffSessionGuard } from '../http/staff-session.guard';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { appendAuditEvent } from '../modules/audit/audit.store';
import { decideDecease, declareDecease } from '../modules/identity/decease.store';
import { uuidv7 } from '../modules/ledger/domain';
import { oneOf, optionalText, requiredText, UUID_PATTERN, whitelistedBody } from './backoffice-body';

const REASON = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]{3,1000}$/u;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * C19 / F-ACC-007 (tranche 1) : décès d'un client. Le support de niveau 2 ou
 * la conformité déclare (motif, date, empreinte de l'acte ; la pièce elle-même
 * reste hors base) ; la conformité décide, jamais le déclarant (la base le
 * refuse aussi). Aucun mouvement de fonds ici : la restitution aux ayants
 * droit est la tranche 2 (D116). Audit chaîné sans la pièce ni son empreinte.
 */
@Controller('v1/backoffice')
@UseGuards(StaffSessionGuard)
export class BackofficeDeceaseController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Post('customers/:accountId/decease-cases')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async declare(@CurrentStaff() staff: AdminPrincipal, @Param('accountId') accountId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const id = requiredText(accountId, UUID_PATTERN);
    const value = whitelistedBody(body, ['deathDate', 'certificateSha256', 'reason']);
    const deathDate = requiredText(value['deathDate'], DATE);
    const certificateSha256 = requiredText(value['certificateSha256'], SHA256_HEX);
    const reason = requiredText(value['reason'], REASON).trim();
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    assertAuthorized(staff, 'DECLARE_CUSTOMER_DEATH', { reason });
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `bo-decease-declare:${staff.actorId}:${id}`, key, request: { deathDate, certificateSha256, reason } }, async (client) => {
      const declared = await declareDecease(client, { id: uuidv7(), accountId: id, deathDate, certificateSha256, reason, actorId: staff.actorId });
      await appendAuditEvent(client, {
        eventType: 'BACKOFFICE_ACTION', actorId: staff.actorId, action: 'DECEASE_DECLARED', targetType: 'CUSTOMER_ACCOUNT', targetId: id,
        outcome: 'SUCCESS', reason, refs: { case_id: declared.caseId, account_id: id },
      });
      return { status: 201, body: { caseId: declared.caseId, accountId: id, status: 'PENDING', declaredAt: declared.declaredAt } };
    });
    return result.body;
  }

  @Post('decease-cases/:caseId/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public async decide(@CurrentStaff() staff: AdminPrincipal, @Param('caseId') caseId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const id = requiredText(caseId, UUID_PATTERN);
    const value = whitelistedBody(body, ['decision'], ['reason']);
    const decision = oneOf(value['decision'], ['APPROVED', 'REJECTED'] as const);
    const reason = optionalText(value['reason']);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    assertAuthorized(staff, 'DECIDE_CUSTOMER_DEATH', reason === undefined ? {} : { reason });
    const fingerprint = reason === undefined ? { decision } : { decision, reason };
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `bo-decease-decide:${staff.actorId}:${id}`, key, request: fingerprint }, async (client) => {
      const decided = await decideDecease(client, { caseId: id, decision, actorId: staff.actorId, ...(reason === undefined ? {} : { reason }) });
      await appendAuditEvent(client, {
        eventType: 'BACKOFFICE_ACTION', actorId: staff.actorId, action: 'DECEASE_DECIDED', targetType: 'CUSTOMER_ACCOUNT', targetId: decided.accountId,
        outcome: 'SUCCESS', ...(reason === undefined ? {} : { reason }),
        refs: { case_id: id, account_id: decided.accountId, decision, frozen_goals: decided.frozenGoals },
      });
      return { status: 200, body: { caseId: id, decision, frozenGoals: decided.frozenGoals } };
    });
    if (typeof (result.body as { frozenGoals?: unknown }).frozenGoals !== 'number') throw new BusinessError('INTERNAL_ERROR');
    return result.body;
  }
}

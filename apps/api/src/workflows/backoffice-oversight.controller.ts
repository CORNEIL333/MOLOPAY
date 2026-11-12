import { Body, Controller, Header, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { JsonValue } from '@achat/chain';
import { PG_POOL, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CurrentStaff, StaffSessionGuard } from '../http/staff-session.guard';
import type { AdminPrincipal } from '../modules/admin/domain';
import { uuidv7 } from '../modules/ledger/domain';
import { oneOf, optionalText, requiredText, UUID_PATTERN, whitelistedBody } from './backoffice-body';
import { closeComplaintBySupport, openDisputeAndNotify, resolveDisputeAndNotify } from './dispute-notifications';
import {
  approveSuspenseLineJustification,
  decideGapClassification,
  proposeGapClassification,
  proposeSuspenseLineJustification,
} from './reconciliation-classification';
import { decideRiskAlert } from './risk-detection';

type Result = { readonly status: number; readonly body: JsonValue };
const TEXT = /^[\s\S]{1,1000}$/;

/**
 * D53–D56 / D62 : contrôle et conformité au back-office — classement des
 * écarts et suspens (maker-checker), alertes de fraude (décision tracée),
 * litiges et réclamations. Les règles restent celles des flux et de la base.
 */
@Controller('v1/backoffice')
@UseGuards(StaffSessionGuard)
export class BackofficeOversightController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  private async run(staff: AdminPrincipal, request: HttpRequest, scope: string, fingerprint: JsonValue, command: (client: PoolClient) => Promise<Result>): Promise<JsonValue> {
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `${scope}:${staff.actorId}`, key, request: fingerprint }, command);
    return result.body;
  }

  // --- Rapprochement (D54, D55) ---

  @Post('reconciliation/incidents/:incidentId/classifications')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public proposeClassification(@CurrentStaff() staff: AdminPrincipal, @Param('incidentId') incidentId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = requiredText(incidentId, UUID_PATTERN);
    const value = whitelistedBody(body, ['classification', 'explanation']);
    const classification = oneOf(value['classification'], ['IN_TRANSIT', 'FEES', 'DUPLICATE', 'UNKNOWN'] as const);
    const explanation = requiredText(value['explanation'], TEXT);
    return this.run(staff, request, `bo-gap-propose:${id}`, { classification, explanation }, async (client) => {
      const proposalId = uuidv7();
      await proposeGapClassification(client, { id: proposalId, incidentId: id, classification, explanation, principal: staff });
      return { status: 201, body: { proposalId, incidentId: id, classification } };
    });
  }

  @Post('reconciliation/classifications/:proposalId/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public decideClassification(@CurrentStaff() staff: AdminPrincipal, @Param('proposalId') proposalId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = requiredText(proposalId, UUID_PATTERN);
    const value = whitelistedBody(body, ['decision'], ['reason']);
    const decision = oneOf(value['decision'], ['APPROVED', 'REJECTED'] as const);
    const reason = optionalText(value['reason']);
    return this.run(staff, request, `bo-gap-decision:${id}`, { decision, reason: reason ?? null }, async (client) => {
      await decideGapClassification(client, { proposalId: id, decision, principal: staff, ...(reason === undefined ? {} : { reason }) });
      return { status: 200, body: { proposalId: id, decision } };
    });
  }

  @Post('reconciliation/suspense/:entryId/justification')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public justifySuspense(@CurrentStaff() staff: AdminPrincipal, @Param('entryId') entryId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = requiredText(entryId, UUID_PATTERN);
    const explanation = requiredText(whitelistedBody(body, ['explanation'])['explanation'], TEXT);
    return this.run(staff, request, `bo-suspense-justify:${id}`, { explanation }, async (client) => {
      await proposeSuspenseLineJustification(client, { entryId: id, explanation, principal: staff });
      return { status: 201, body: { entryId: id } };
    });
  }

  @Post('reconciliation/suspense/:entryId/approval')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public approveSuspense(@CurrentStaff() staff: AdminPrincipal, @Param('entryId') entryId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = requiredText(entryId, UUID_PATTERN);
    whitelistedBody(body ?? {}, []);
    return this.run(staff, request, `bo-suspense-approve:${id}`, {}, async (client) => {
      await approveSuspenseLineJustification(client, { entryId: id, principal: staff });
      return { status: 200, body: { entryId: id, approved: true } };
    });
  }

  // --- Fraude (D53) ---

  @Post('risk/alerts/:alertId/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public decideAlert(@CurrentStaff() staff: AdminPrincipal, @Param('alertId') alertId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = requiredText(alertId, UUID_PATTERN);
    const value = whitelistedBody(body, ['decision', 'reason']);
    const decision = oneOf(value['decision'], ['DISMISSED', 'CONFIRMED'] as const);
    const reason = requiredText(value['reason'], TEXT);
    return this.run(staff, request, `bo-alert-decision:${id}`, { decision, reason }, async (client) => {
      await decideRiskAlert(client, { alertId: id, principal: staff, decision, reason });
      return { status: 200, body: { alertId: id, decision } };
    });
  }

  // --- Litiges et réclamations (D41, D56) ---

  @Post('complaints/:complaintId/disputes')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public openDispute(@CurrentStaff() staff: AdminPrincipal, @Param('complaintId') complaintId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = requiredText(complaintId, UUID_PATTERN);
    whitelistedBody(body ?? {}, []);
    return this.run(staff, request, `bo-dispute-open:${id}`, {}, async (client) => {
      const opened = await openDisputeAndNotify(client, { id: uuidv7(), complaintId: id, principal: staff });
      return { status: 201, body: { disputeId: opened.disputeId, agreementId: opened.agreementId } };
    });
  }

  @Post('disputes/:disputeId/resolution')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public resolveDispute(@CurrentStaff() staff: AdminPrincipal, @Param('disputeId') disputeId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = requiredText(disputeId, UUID_PATTERN);
    whitelistedBody(body ?? {}, []);
    return this.run(staff, request, `bo-dispute-resolve:${id}`, {}, async (client) => {
      const resolved = await resolveDisputeAndNotify(client, { disputeId: id, principal: staff });
      return { status: 200, body: { disputeId: id, agreementStatus: resolved.agreementStatus } };
    });
  }

  @Post('complaints/:complaintId/closure')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public closeComplaint(@CurrentStaff() staff: AdminPrincipal, @Param('complaintId') complaintId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = requiredText(complaintId, UUID_PATTERN);
    const outcome = oneOf(whitelistedBody(body, ['outcome'])['outcome'], ['ANSWERED', 'WITHDRAWN'] as const);
    return this.run(staff, request, `bo-complaint-close:${id}`, { outcome }, async (client) => {
      await closeComplaintBySupport(client, { complaintId: id, outcome, principal: staff });
      return { status: 200, body: { complaintId: id, outcome } };
    });
  }
}

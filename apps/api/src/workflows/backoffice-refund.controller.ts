import type { KeyObject } from 'node:crypto';
import { Body, Controller, Header, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { JsonValue } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CurrentStaff, StaffSessionGuard } from '../http/staff-session.guard';
import type { AdminPrincipal } from '../modules/admin/domain';
import { uuidv7 } from '../modules/ledger/domain';
import { BANK_REFERENCE_PATTERN, oneOf, optionalText, requiredText, UUID_PATTERN, whitelistedBody } from './backoffice-body';
import { decideBeneficiaryPayout, instructBeneficiaryPayout, prepareBeneficiaryPayout, recordBeneficiaryPayoutExecution } from './beneficiary-payout';
import { decideRefund, instructRefund, prepareRefund, recordRefundExecution } from './refund';

/** Clé Ed25519 de la plateforme pour signer les instructions (configuration, HSM en production, D5) ; null : 503. */
export const PLATFORM_SIGNING_KEY = Symbol('PLATFORM_SIGNING_KEY');
export type PlatformSigningKey = { readonly key: KeyObject; readonly keyId: string };

type Result = { readonly status: number; readonly body: JsonValue };

/**
 * D49–D51, D50 / D62 : circuits de sortie de fonds du back-office —
 * remboursements et virements aux bénéficiaires C — avec le principal
 * reconstruit depuis la session du personnel. Les règles (rôles, plafonds,
 * préparateur ≠ décideur, émetteur ≠ confirmateur) restent celles des flux et
 * de la base ; ces routes n'ajoutent que l'authentification et l'idempotence.
 */
@Controller('v1/backoffice')
@UseGuards(StaffSessionGuard)
export class BackofficeRefundController {
  public constructor(
    @Inject(PG_POOL) private readonly database: Database,
    @Inject(PLATFORM_SIGNING_KEY) private readonly signing: PlatformSigningKey | null,
  ) {}

  private async run(staff: AdminPrincipal, request: HttpRequest, scope: string, fingerprint: JsonValue, command: (client: PoolClient) => Promise<Result>): Promise<JsonValue> {
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `${scope}:${staff.actorId}`, key, request: fingerprint }, command);
    return result.body;
  }

  private signingKey(): PlatformSigningKey {
    if (this.signing === null) {
      throw new BusinessError('SIGNING_UNCONFIGURED', 'Clé de signature des instructions non configurée');
    }
    return this.signing;
  }

  private static decision(body: unknown): { readonly decision: 'APPROVED' | 'REJECTED'; readonly reason?: string } {
    const value = whitelistedBody(body, ['decision'], ['reason']);
    const decision = oneOf(value['decision'], ['APPROVED', 'REJECTED'] as const);
    const reason = optionalText(value['reason']);
    return reason === undefined ? { decision } : { decision, reason };
  }

  private static execution(body: unknown): { readonly outcome: 'EXECUTED' | 'REJECTED'; readonly bankReference: string } {
    const value = whitelistedBody(body, ['outcome', 'bankReference']);
    return { outcome: oneOf(value['outcome'], ['EXECUTED', 'REJECTED'] as const), bankReference: requiredText(value['bankReference'], BANK_REFERENCE_PATTERN) };
  }

  private static id(value: string): string {
    return requiredText(value, UUID_PATTERN);
  }

  // --- Remboursements (D49, D51) ---

  @Post('refunds')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public prepareRefund(@CurrentStaff() staff: AdminPrincipal, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const value = whitelistedBody(body, ['agreementId', 'kind']);
    const agreementId = requiredText(value['agreementId'], UUID_PATTERN);
    const kind = oneOf(value['kind'], ['CANCELLATION', 'SURPLUS'] as const);
    return this.run(staff, request, 'bo-refund-prepare', { agreementId, kind }, async (client) => {
      const refund = await prepareRefund(client, { id: uuidv7(), agreementId, kind, principal: staff });
      return { status: 201, body: { refundId: refund.refundId, kind: refund.kind, amountXaf: refund.amountXaf.toString() } };
    });
  }

  @Post('refunds/:refundId/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public decideRefund(@CurrentStaff() staff: AdminPrincipal, @Param('refundId') refundId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = BackofficeRefundController.id(refundId);
    const input = BackofficeRefundController.decision(body);
    return this.run(staff, request, `bo-refund-decision:${id}`, { ...input }, async (client) => {
      await decideRefund(client, { refundId: id, principal: staff, ...input });
      return { status: 200, body: { refundId: id, decision: input.decision } };
    });
  }

  @Post('refunds/:refundId/instruction')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public instructRefund(@CurrentStaff() staff: AdminPrincipal, @Param('refundId') refundId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = BackofficeRefundController.id(refundId);
    whitelistedBody(body ?? {}, []);
    const signing = this.signingKey();
    return this.run(staff, request, `bo-refund-instruction:${id}`, {}, async (client) => {
      const signed = await instructRefund(client, { refundId: id, principal: staff, signingKey: signing.key, keyId: signing.keyId });
      return { status: 201, body: { document: { ...signed.document }, signature: signed.signature.toString('base64'), keyId: signing.keyId } };
    });
  }

  @Post('refunds/:refundId/execution')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public recordRefundExecution(@CurrentStaff() staff: AdminPrincipal, @Param('refundId') refundId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = BackofficeRefundController.id(refundId);
    const input = BackofficeRefundController.execution(body);
    return this.run(staff, request, `bo-refund-execution:${id}`, { ...input }, async (client) => {
      const done = await recordRefundExecution(client, { refundId: id, principal: staff, ...input });
      return { status: 200, body: { refundId: id, outcome: input.outcome, entryId: done.entryId } };
    });
  }

  // --- Virements aux bénéficiaires C (D50) ---

  @Post('beneficiary-payouts')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public preparePayout(@CurrentStaff() staff: AdminPrincipal, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const agreementId = requiredText(whitelistedBody(body, ['agreementId'])['agreementId'], UUID_PATTERN);
    return this.run(staff, request, 'bo-payout-prepare', { agreementId }, async (client) => {
      const payout = await prepareBeneficiaryPayout(client, { id: uuidv7(), agreementId, principal: staff });
      return { status: 201, body: { payoutId: payout.payoutId, beneficiaryId: payout.beneficiaryId, amountXaf: payout.amountXaf.toString() } };
    });
  }

  @Post('beneficiary-payouts/:payoutId/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public decidePayout(@CurrentStaff() staff: AdminPrincipal, @Param('payoutId') payoutId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = BackofficeRefundController.id(payoutId);
    const input = BackofficeRefundController.decision(body);
    return this.run(staff, request, `bo-payout-decision:${id}`, { ...input }, async (client) => {
      await decideBeneficiaryPayout(client, { payoutId: id, principal: staff, ...input });
      return { status: 200, body: { payoutId: id, decision: input.decision } };
    });
  }

  @Post('beneficiary-payouts/:payoutId/instruction')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public instructPayout(@CurrentStaff() staff: AdminPrincipal, @Param('payoutId') payoutId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = BackofficeRefundController.id(payoutId);
    whitelistedBody(body ?? {}, []);
    const signing = this.signingKey();
    return this.run(staff, request, `bo-payout-instruction:${id}`, {}, async (client) => {
      const signed = await instructBeneficiaryPayout(client, { payoutId: id, principal: staff, signingKey: signing.key, keyId: signing.keyId });
      return { status: 201, body: { document: { ...signed.document }, signature: signed.signature.toString('base64'), keyId: signing.keyId } };
    });
  }

  @Post('beneficiary-payouts/:payoutId/execution')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public recordPayoutExecution(@CurrentStaff() staff: AdminPrincipal, @Param('payoutId') payoutId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = BackofficeRefundController.id(payoutId);
    const input = BackofficeRefundController.execution(body);
    return this.run(staff, request, `bo-payout-execution:${id}`, { ...input }, async (client) => {
      const done = await recordBeneficiaryPayoutExecution(client, { payoutId: id, principal: staff, ...input });
      return { status: 200, body: { payoutId: id, outcome: input.outcome, entryId: done.entryId } };
    });
  }
}

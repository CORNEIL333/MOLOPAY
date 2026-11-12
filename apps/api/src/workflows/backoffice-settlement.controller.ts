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
import { PLATFORM_SIGNING_KEY, type PlatformSigningKey } from './backoffice-refund.controller';
import { decidePayout, instructPayout, preparePayout, recordPayoutExecution } from './settlement-payout';

type Result = { readonly status: number; readonly body: JsonValue };
const CITY = /^(yaounde|douala)$/;

/**
 * D46 / D62 : règlements des marchands au back-office. La ville est fournie
 * par l'agent et contrôlée deux fois par les flux : dans son périmètre
 * (ABAC, SEC-AUTHZ-001) et servie par l'offre de l'accord. Commission et
 * délai de contestation restent des paramètres publiés, fermés par défaut.
 */
@Controller('v1/backoffice/settlements')
@UseGuards(StaffSessionGuard)
export class BackofficeSettlementController {
  public constructor(
    @Inject(PG_POOL) private readonly database: Database,
    @Inject(PLATFORM_SIGNING_KEY) private readonly signing: PlatformSigningKey | null,
  ) {}

  private async run(staff: AdminPrincipal, request: HttpRequest, scope: string, fingerprint: JsonValue, command: (client: PoolClient) => Promise<Result>): Promise<JsonValue> {
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `${scope}:${staff.actorId}`, key, request: fingerprint }, command);
    return result.body;
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public prepare(@CurrentStaff() staff: AdminPrincipal, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const value = whitelistedBody(body, ['agreementId', 'cityId']);
    const agreementId = requiredText(value['agreementId'], UUID_PATTERN);
    const cityId = requiredText(value['cityId'], CITY);
    return this.run(staff, request, 'bo-settlement-prepare', { agreementId, cityId }, async (client) => {
      const payout = await preparePayout(client, { id: uuidv7(), agreementId, cityId, principal: staff });
      return {
        status: 201,
        body: {
          payoutId: payout.payoutId,
          partnerId: payout.partnerId,
          grossXaf: payout.grossXaf.toString(),
          commissionXaf: payout.commissionXaf.toString(),
          netXaf: payout.netXaf.toString(),
        },
      };
    });
  }

  @Post(':payoutId/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public decide(@CurrentStaff() staff: AdminPrincipal, @Param('payoutId') payoutId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = requiredText(payoutId, UUID_PATTERN);
    const value = whitelistedBody(body, ['decision', 'cityId'], ['reason']);
    const decision = oneOf(value['decision'], ['APPROVED', 'REJECTED'] as const);
    const cityId = requiredText(value['cityId'], CITY);
    const reason = optionalText(value['reason']);
    return this.run(staff, request, `bo-settlement-decision:${id}`, { decision, cityId, reason: reason ?? null }, async (client) => {
      const decided = await decidePayout(client, { payoutId: id, principal: staff, decision, reason, cityId });
      return { status: 200, body: { payoutId: id, status: decided.status, commissionEntryId: decided.commissionEntryId } };
    });
  }

  @Post(':payoutId/instruction')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public instruct(@CurrentStaff() staff: AdminPrincipal, @Param('payoutId') payoutId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = requiredText(payoutId, UUID_PATTERN);
    const cityId = requiredText(whitelistedBody(body, ['cityId'])['cityId'], CITY);
    const signing = this.signing;
    if (signing === null) {
      throw new BusinessError('SIGNING_UNCONFIGURED', 'Clé de signature des instructions non configurée');
    }
    return this.run(staff, request, `bo-settlement-instruction:${id}`, { cityId }, async (client) => {
      const signed = await instructPayout(client, { payoutId: id, principal: staff, cityId, signingKey: signing.key, keyId: signing.keyId });
      return { status: 201, body: { document: { ...signed.document }, signature: signed.signature.toString('base64'), keyId: signing.keyId } };
    });
  }

  @Post(':payoutId/execution')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public execute(@CurrentStaff() staff: AdminPrincipal, @Param('payoutId') payoutId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = requiredText(payoutId, UUID_PATTERN);
    const value = whitelistedBody(body, ['outcome', 'bankReference', 'cityId']);
    const outcome = oneOf(value['outcome'], ['EXECUTED', 'REJECTED'] as const);
    const bankReference = requiredText(value['bankReference'], BANK_REFERENCE_PATTERN);
    const cityId = requiredText(value['cityId'], CITY);
    return this.run(staff, request, `bo-settlement-execution:${id}`, { outcome, bankReference, cityId }, async (client) => {
      const done = await recordPayoutExecution(client, { payoutId: id, principal: staff, cityId, outcome, bankReference });
      return { status: 200, body: { payoutId: id, outcome, entryId: done.entryId } };
    });
  }
}

import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { JsonValue } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, withTransaction, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CurrentCustomer, CustomerSessionGuard } from '../http/session.guard';
import { getAgreement } from '../modules/agreements/agreement.store';
import { goalFromStored } from '../modules/agreements/goal.api';
import { verifyPinFromStore } from '../modules/identity/pin.store';
import type { AuthenticatedCustomer } from '../modules/identity/session.store';
import { uuidv7 } from '../modules/ledger/domain';
import { getBeneficiaryReceipt } from '../modules/settlement/beneficiary-payout.store';
import { payBeneficiaryForCustomer, submitBeneficiaryDocument } from './beneficiary-payment';
import { PIN_PEPPER } from './goal-signing.controller';

type SqlClient = Parameters<Parameters<typeof withTransaction>[1]>[0];

const PIN_PATTERN = /^\d{6}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function invalid(message: string): never {
  throw new BusinessError('SETTLEMENT_INVALID_REQUEST', message);
}

/** Corps en liste blanche : champs exactement attendus, sinon 400. */
function objectWithOnly(body: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalid('corps JSON objet attendu');
  }
  const value = body as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      invalid(`champ non autorisé : ${key}`);
    }
  }
  return value;
}

/** Objectif du client de la session ; tout autre cas est introuvable (aucun oracle). */
async function assertOwnGoal(client: SqlClient, customerId: string, goalId: string): Promise<void> {
  const stored = await getAgreement(client, goalId);
  if (stored === null || stored.agreement.terms.customerId !== customerId) {
    throw new BusinessError('AGREEMENT_NOT_FOUND', 'Objectif introuvable');
  }
}

/**
 * F-PLN-002/003 (D48) : actions du client sur le bénéficiaire de son objectif C.
 * Dépôt de l'empreinte de la pièce (la conformité l'examine en maker-checker),
 * puis règlement au bénéficiaire sous PIN (SEC-AUTH-002). Le PIN est vérifié
 * dans sa propre transaction validée : un échec reste compté.
 */
@Controller()
@UseGuards(CustomerSessionGuard)
export class BeneficiaryController {
  public constructor(
    @Inject(PG_POOL) private readonly database: Database,
    @Inject(PIN_PEPPER) private readonly pinPepper: Uint8Array | null,
  ) {}

  @Post('v1/goals/:goalId/beneficiary-documents')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async submitDocument(
    @CurrentCustomer() actor: AuthenticatedCustomer,
    @Param('goalId') goalId: string,
    @Req() request: HttpRequest,
    @Body() body: unknown,
  ): Promise<JsonValue> {
    const value = objectWithOnly(body, ['kind', 'sha256']);
    const kind = value['kind'];
    const sha256 = value['sha256'];
    if (kind !== 'LEASE' && kind !== 'LAND_TITLE') {
      invalid('nature de pièce LEASE ou LAND_TITLE attendue');
    }
    if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
      invalid('empreinte SHA-256 hexadécimale (minuscules) attendue');
    }
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `beneficiary-document:${actor.accountId}:${goalId}`, key, request: { goalId, kind, sha256 } },
      async (client) => {
        await assertOwnGoal(client, actor.accountId, goalId);
        const documentId = uuidv7();
        await submitBeneficiaryDocument(client, { id: documentId, agreementId: goalId, customerId: actor.accountId, kind, sha256Hex: sha256 });
        return { status: 201, body: { documentId, goalId, kind, sha256, reviewStatus: 'PENDING' } };
      },
    );
    if (result.status !== 201) {
      throw new BusinessError('INTERNAL_ERROR');
    }
    return result.body;
  }

  /** F-PLN-003 / D58 : reçu du virement exécuté au bénéficiaire (lecture seule). */
  @Get('v1/goals/:goalId/beneficiary-receipt')
  @Header('Cache-Control', 'private, no-store')
  public receipt(@CurrentCustomer() actor: AuthenticatedCustomer, @Param('goalId') goalId: string): Promise<JsonValue> {
    return withTransaction({ ...this.database, role: 'app_ro' }, async (client) => {
      await assertOwnGoal(client, actor.accountId, goalId);
      const receipt = await getBeneficiaryReceipt(client, goalId);
      if (receipt === null) {
        throw new BusinessError('SETTLEMENT_NOT_FOUND', 'aucun virement exécuté pour cet objectif');
      }
      return { ...receipt, amountXaf: receipt.amountXaf.toString() };
    });
  }

  @Post('v1/goals/:goalId/beneficiary-payment')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public async pay(
    @CurrentCustomer() actor: AuthenticatedCustomer,
    @Param('goalId') goalId: string,
    @Req() request: HttpRequest,
    @Body() body: unknown,
  ): Promise<JsonValue> {
    const pepper = this.pinPepper;
    if (pepper === null) {
      throw new BusinessError('PIN_UNCONFIGURED', 'Vérification du PIN non configurée');
    }
    const value = objectWithOnly(body, ['pin']);
    const pin = value['pin'];
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
      invalid('PIN à 6 chiffres attendu');
    }
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const pinCheck = await withTransaction({ ...this.database, role: 'app_rw' }, (client) =>
      verifyPinFromStore(client, { accountId: actor.accountId, deviceId: actor.deviceId, pin, pepper }),
    );
    if (!pinCheck.ok) {
      throw new BusinessError(pinCheck.code, 'PIN refusé');
    }
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      // Le PIN n'entre jamais dans l'empreinte mémorisée.
      { scope: `beneficiary-payment:${actor.accountId}:${goalId}`, key, request: { goalId } },
      async (client) => {
        await assertOwnGoal(client, actor.accountId, goalId);
        await payBeneficiaryForCustomer(client, { agreementId: goalId, customerId: actor.accountId });
        const updated = await getAgreement(client, goalId);
        if (updated === null) {
          throw new BusinessError('AGREEMENT_NOT_FOUND', 'Objectif introuvable');
        }
        return { status: 200, body: { ...(await goalFromStored(client, updated)) } };
      },
    );
    if (result.status !== 200) {
      throw new BusinessError('INTERNAL_ERROR');
    }
    return result.body;
  }
}

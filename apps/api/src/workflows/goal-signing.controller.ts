import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { JsonValue } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { CustomerQuota } from '../http/customer-quota';
import { PG_POOL, withTransaction, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CurrentCustomer, CustomerSessionGuard } from '../http/session.guard';
import {
  agreementSigningPayload,
  appendAgreementTransition,
  getAgreement,
  lockStoredAgreement,
  type StoredAgreement,
} from '../modules/agreements/agreement.store';
import { goalFromStored } from '../modules/agreements/goal.api';
import { getSigningDevice } from '../modules/identity/device.store';
import { verifyPinFromStore } from '../modules/identity/pin.store';
import type { AuthenticatedCustomer } from '../modules/identity/session.store';

export const PIN_PEPPER = Symbol('PIN_PEPPER');

type GoalAction = 'ACTIVATE' | 'CANCEL' | 'LOCK';
const PIN_PATTERN = /^\d{6}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function invalid(message: string): never {
  throw new BusinessError('AGREEMENT_INVALID_REQUEST', message);
}

/** Corps en liste blanche : PIN (6 chiffres) et, sauf verrouillage, signature d'appareil en base64. */
function parseBody(action: GoalAction, body: unknown): { readonly pin: string; readonly signature: Buffer | null } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalid('corps JSON objet attendu');
  }
  const value = body as Record<string, unknown>;
  const allowed = action === 'LOCK' ? ['pin'] : ['pin', 'signature'];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      invalid(`champ non autorisé : ${key}`);
    }
  }
  if (typeof value['pin'] !== 'string' || !PIN_PATTERN.test(value['pin'])) {
    invalid('PIN à 6 chiffres attendu');
  }
  if (action === 'LOCK') {
    return { pin: value['pin'], signature: null };
  }
  const signature = value['signature'];
  if (typeof signature !== 'string' || !BASE64_PATTERN.test(signature)) {
    invalid('signature base64 attendue');
  }
  return { pin: value['pin'], signature: Buffer.from(signature, 'base64') };
}

/**
 * D32 tranche 2 : actions du client sur son objectif, sous PIN (SEC-AUTH-002)
 * et, pour l'activation et l'annulation, signature Ed25519 de l'appareil de
 * la session (INT-NR-001, D28). Hors modules : orchestre identity (PIN,
 * appareil) et agreements (transition), qui ne se connaissent pas.
 * Le PIN est vérifié dans sa propre transaction validée : un échec reste
 * compté même si l'action est refusée.
 */
@Controller()
@UseGuards(CustomerSessionGuard)
export class GoalSigningController {
  public constructor(
    @Inject(PG_POOL) private readonly database: Database,
    @Inject(PIN_PEPPER) private readonly pinPepper: Uint8Array | null,
  ) {}

  /**
   * Octets exacts à signer par l'appareil (format D28), pour la transition
   * demandée depuis l'état courant. Lecture seule ; aucune signature n'est
   * produite par le serveur.
   */
  @Get('v1/goals/:goalId/signing-payload')
  @Header('Cache-Control', 'private, no-store')
  public payload(@CurrentCustomer() actor: AuthenticatedCustomer, @Param('goalId') goalId: string, @Query() query: unknown): Promise<unknown> {
    const transition = (query as Record<string, unknown> | null)?.['transition'];
    if (transition !== 'ACTIVATE' && transition !== 'CANCEL') {
      invalid('transition ACTIVATE ou CANCEL attendue');
    }
    return withTransaction({ ...this.database, role: 'app_ro' }, async (client) => {
      const current = await getAgreement(client, goalId);
      if (current === null || current.agreement.terms.customerId !== actor.accountId) {
        throw new BusinessError('AGREEMENT_NOT_FOUND', 'Objectif introuvable');
      }
      const payload = agreementSigningPayload({
        agreementId: goalId,
        termsHash: current.agreement.termsHash,
        from: current.agreement.status,
        to: transition === 'ACTIVATE' ? 'ACTIVE' : 'CANCELLED_BY_CUSTOMER',
        seq: current.seq + 1,
      });
      return { transition, payloadBase64: payload.toString('base64'), seq: current.seq + 1 };
    });
  }

  @Post('v1/goals/:goalId/activation')
  @CustomerQuota('GOAL_SIGNED_ACTION')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public activate(@CurrentCustomer() actor: AuthenticatedCustomer, @Param('goalId') goalId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    return this.execute('ACTIVATE', actor, goalId, request, body);
  }

  @Post('v1/goals/:goalId/cancellation')
  @CustomerQuota('GOAL_SIGNED_ACTION')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public cancel(@CurrentCustomer() actor: AuthenticatedCustomer, @Param('goalId') goalId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    return this.execute('CANCEL', actor, goalId, request, body);
  }

  @Post('v1/goals/:goalId/lock')
  @CustomerQuota('GOAL_SIGNED_ACTION')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public lock(@CurrentCustomer() actor: AuthenticatedCustomer, @Param('goalId') goalId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    return this.execute('LOCK', actor, goalId, request, body);
  }

  private async execute(action: GoalAction, actor: AuthenticatedCustomer, goalId: string, request: HttpRequest, body: unknown): Promise<JsonValue> {
    const pepper = this.pinPepper;
    if (pepper === null) {
      throw new BusinessError('PIN_UNCONFIGURED', 'Vérification du PIN non configurée');
    }
    const parsed = parseBody(action, body);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const pinCheck = await withTransaction({ ...this.database, role: 'app_rw' }, (client) =>
      verifyPinFromStore(client, { accountId: actor.accountId, deviceId: actor.deviceId, pin: parsed.pin, pepper }),
    );
    if (!pinCheck.ok) {
      throw new BusinessError(pinCheck.code, 'PIN refusé');
    }
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      {
        scope: `goal-${action.toLowerCase()}:${actor.accountId}:${goalId}`,
        key,
        // Le PIN n'entre jamais dans l'empreinte mémorisée ; la signature seulement par son hash.
        request: {
          action,
          goalId,
          signature: parsed.signature === null ? null : createHash('sha256').update(parsed.signature).digest('hex'),
        },
      },
      async (client) => {
        const current = await getAgreement(client, goalId);
        if (current === null || current.agreement.terms.customerId !== actor.accountId) {
          throw new BusinessError('AGREEMENT_NOT_FOUND', 'Objectif introuvable');
        }
        let updated: StoredAgreement;
        if (action === 'LOCK') {
          updated = await lockStoredAgreement(client, { agreementId: goalId, actorId: actor.accountId });
        } else {
          const device = await getSigningDevice(client, actor.deviceId);
          if (device === null || parsed.signature === null) {
            throw new BusinessError('AGREEMENT_SIGNATURE_INVALID', 'Appareil de signature inconnu');
          }
          updated = await appendAgreementTransition(client, {
            agreementId: goalId,
            to: action === 'ACTIVATE' ? 'ACTIVE' : 'CANCELLED_BY_CUSTOMER',
            actorId: actor.accountId,
            signature: { device, signature: parsed.signature },
          });
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

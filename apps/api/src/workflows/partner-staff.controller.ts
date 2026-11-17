import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { JsonValue } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, withTransaction, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CurrentPartner, PartnerSessionGuard } from '../http/partner-session.guard';
import {
  findPartnerSeller,
  insertPartnerSeller,
  insertPartnerUserDisable,
  issuePartnerEnrollment,
  listPartnerUsers,
  type PartnerPrincipal,
} from '../modules/catalog/partner-user.store';
import { listPartnerOrders } from '../modules/agreements/partner-orders.store';
import { uuidv7 } from '../modules/ledger/domain';
import { listPartnerPayouts } from '../modules/settlement/partner-payouts.store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOGIN = /^[a-z][a-z0-9._-]{2,63}$/;

function invalid(): never {
  throw new BusinessError('REQUEST_INVALID', 'Corps de requête invalide');
}

function only(body: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalid();
  }
  const value = body as Record<string, unknown>;
  const present = Object.keys(value);
  if (present.length !== keys.length || !present.every((key) => keys.includes(key))) {
    invalid();
  }
  return value;
}

function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    invalid();
  }
  return value;
}

/** F-PRT-003 : la gestion du personnel est réservée au gérant (avant toute lecture). */
function assertManager(partner: PartnerPrincipal): void {
  if (partner.role !== 'MANAGER') {
    throw new BusinessError('PARTNER_ROLE_DENIED', 'réservé au gérant');
  }
}

/**
 * D63 / F-PRT-003 / F-PRT-004 : tableau des commandes (gérant et vendeur) ;
 * le gérant gère les vendeurs de son seul
 * partenaire (pris dans la session). Compte inconnu, d'un autre partenaire
 * ou gérant : même 404 (aucun oracle). La base revérifie le gérant actif du
 * même partenaire (0057).
 */
@Controller('v1/partner')
@UseGuards(PartnerSessionGuard)
export class PartnerStaffController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  private async seller(client: Parameters<typeof findPartnerSeller>[0], partner: PartnerPrincipal, sellerId: string): Promise<string> {
    const found = await findPartnerSeller(client, { userId: sellerId, partnerId: partner.partnerId });
    if (found === null) {
      throw new BusinessError('PARTNER_USER_NOT_FOUND', 'compte introuvable');
    }
    return found.userId;
  }

  /** F-PRT-004 : gérant et vendeur ; commandes du seul partenaire de la session, sans donnée client. */
  @Get('orders')
  @Header('Cache-Control', 'private, no-store')
  public async orders(@CurrentPartner() partner: PartnerPrincipal): Promise<unknown> {
    return withTransaction({ ...this.database, role: 'app_ro' }, async (client) => {
      const asOf = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]?.now ?? new Date(0);
      return { orders: await listPartnerOrders(client, partner.partnerId), asOf: asOf.toISOString() };
    });
  }

  /** F-PRT-003 : règlements au gérant seul ; le vendeur ne les voit pas. */
  @Get('payouts')
  @Header('Cache-Control', 'private, no-store')
  public async payouts(@CurrentPartner() partner: PartnerPrincipal): Promise<unknown> {
    assertManager(partner);
    return withTransaction({ ...this.database, role: 'app_ro' }, async (client) => {
      const asOf = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]?.now ?? new Date(0);
      return { payouts: await listPartnerPayouts(client, partner.partnerId), asOf: asOf.toISOString() };
    });
  }

  @Get('users')
  @Header('Cache-Control', 'private, no-store')
  public async list(@CurrentPartner() partner: PartnerPrincipal): Promise<unknown> {
    assertManager(partner);
    const users = await withTransaction({ ...this.database, role: 'app_ro' }, (client) => listPartnerUsers(client, partner.partnerId));
    return { users };
  }

  @Post('sellers')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async create(@CurrentPartner() partner: PartnerPrincipal, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    assertManager(partner);
    const login = text(only(body, ['login'])['login'], LOGIN);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `partner-seller:${partner.userId}`, key, request: { login } }, async (client) => {
      const sellerId = uuidv7();
      await insertPartnerSeller(client, { id: sellerId, manager: partner, login });
      return { status: 201, body: { sellerId, login } };
    });
    return result.body;
  }

  /**
   * Enrôlement d'une clé du vendeur : le jeton (à remettre en main propre)
   * est renvoyé une seule fois et n'entre jamais dans le magasin
   * d'idempotence ; un rejeu renvoie le défi sans jeton.
   */
  @Post('sellers/:sellerId/enrollments')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async enroll(@CurrentPartner() partner: PartnerPrincipal, @Param('sellerId') sellerId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    assertManager(partner);
    const target = text(sellerId, UUID);
    only(body ?? {}, []);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    let enrollmentToken: string | null = null;
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `partner-seller-enroll:${partner.userId}:${target}`, key, request: {} }, async (client) => {
      const id = await this.seller(client, partner, target);
      const issued = await issuePartnerEnrollment(client, { userId: id, by: { manager: partner } });
      enrollmentToken = issued.enrollmentToken;
      return { status: 201, body: { sellerId: id, challengeId: issued.challengeId, challenge: issued.challenge.toString('base64url') } };
    });
    return result.replayed || enrollmentToken === null ? result.body : { ...(result.body as Record<string, JsonValue>), enrollmentToken };
  }

  @Post('sellers/:sellerId/disable')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public async disable(@CurrentPartner() partner: PartnerPrincipal, @Param('sellerId') sellerId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    assertManager(partner);
    const target = text(sellerId, UUID);
    const reason = only(body, ['reason'])['reason'];
    if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 1000) {
      invalid();
    }
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `partner-seller-disable:${partner.userId}:${target}`, key, request: { reason } }, async (client) => {
      const id = await this.seller(client, partner, target);
      await insertPartnerUserDisable(client, { userId: id, by: { manager: partner }, reason });
      return { status: 200, body: { sellerId: id, disabled: true } };
    });
    return result.body;
  }
}

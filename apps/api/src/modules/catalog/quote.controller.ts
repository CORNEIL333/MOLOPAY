import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { components } from '@achat/contracts/api';
import type { JsonValue } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { parseXaf } from '@achat/money';
import { PG_POOL, withTransaction, type Database } from '../../http/database';
import type { HttpRequest } from '../../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../../http/idempotency';
import { CurrentCustomer, CustomerSessionGuard } from '../../http/session.guard';
import { getPaymentPlan, listPaymentPlans, PLAN_MODELS, type PlanModel } from './payment-plan.store';
import { getPublicOffer, parsePublicOfferId } from './public-offer.store';
import { computeQuote } from './quote';

type Quote = components['schemas']['Quote'];
type PaymentPlanList = components['schemas']['PaymentPlanList'];
type AuthenticatedCustomer = { readonly accountId: string };

// Validité affichée d'un devis indicatif (non conservé, prix figé à l'accord).
const QUOTE_DISPLAY_VALIDITY_MS = 15 * 60_000;
// Cameroun : UTC+1 toute l'année (pas d'heure d'été).
const DOUALA_OFFSET_MS = 3_600_000;

function invalid(message: string): never {
  throw new BusinessError('CATALOG_INVALID_REQUEST', message);
}

function parseQuoteRequest(body: unknown): { readonly planId: string; readonly durationMonths: number } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalid('corps JSON objet attendu');
  }
  const value = body as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (key !== 'planId' && key !== 'durationMonths') {
      invalid(`champ non autorisé : ${key}`);
    }
  }
  if (typeof value['planId'] !== 'string' || typeof value['durationMonths'] !== 'number') {
    invalid('planId et durationMonths requis');
  }
  return { planId: value['planId'], durationMonths: value['durationMonths'] };
}

/** D26 / F-CAT-004 : plans approuvés (public) et devis indicatif d'une offre A (client connecté). */
@Controller()
export class QuoteController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Get('v1/plans')
  public plans(@Query() query: unknown): Promise<PaymentPlanList> {
    const value = (query ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      if (key !== 'model') {
        invalid(`filtre non autorisé : ${key}`);
      }
    }
    const model = value['model'];
    if (model !== undefined && !(PLAN_MODELS as readonly unknown[]).includes(model)) {
      invalid('modèle non ouvert');
    }
    return withTransaction({ ...this.database, role: 'app_ro' }, async (client) => ({
      plans: (await listPaymentPlans(client, (model as PlanModel | undefined) ?? null)).map((plan) => ({
        planId: plan.planId,
        model: plan.model,
        rhythm: plan.rhythm,
        minAmountXaf: plan.minAmountXaf.toString(),
        maxDurationMonths: plan.maxDurationMonths,
      })),
    }));
  }

  @Post('v1/offers/:offerId/quotes')
  @UseGuards(CustomerSessionGuard)
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async quote(
    @CurrentCustomer() actor: AuthenticatedCustomer,
    @Param('offerId') rawOfferId: string,
    @Req() request: HttpRequest,
    @Body() body: unknown,
  ): Promise<JsonValue> {
    const offerId = parsePublicOfferId(rawOfferId);
    const input = parseQuoteRequest(body);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `quote:${actor.accountId}:${offerId}`, key, request: { ...input } },
      async (client) => {
        const offer = await getPublicOffer(client, offerId);
        const plan = await getPaymentPlan(client, input.planId);
        if (plan === null || plan.model !== 'SAVE_THEN_BUY' || !offer.models.includes('SAVE_THEN_BUY')) {
          throw new BusinessError('CATALOG_PLAN_NOT_APPROVED', 'plan non ouvert pour cette offre');
        }
        const now = Date.now();
        const computed = computeQuote({
          plan,
          totalXaf: parseXaf(offer.priceXaf).amount,
          durationMonths: input.durationMonths,
          startDate: new Date(now + DOUALA_OFFSET_MS).toISOString().slice(0, 10),
        });
        const quote: Quote = {
          // Devis non conservé : identifiant aléatoire, sans ordre ni sens.
          quoteId: randomUUID(),
          offerId,
          model: 'SAVE_THEN_BUY',
          planId: plan.planId,
          durationMonths: input.durationMonths,
          totalXaf: computed.totalXaf.toString(),
          feesXaf: computed.feesXaf.toString(),
          tegPercent: null,
          installments: computed.installments.map((i) => ({ dueDate: i.dueDate, amountXaf: i.amountXaf.toString() })),
          expiresAt: new Date(now + QUOTE_DISPLAY_VALIDITY_MS).toISOString(),
        };
        return { status: 201, body: { ...quote } };
      },
    );
    if (result.status !== 201) {
      throw new BusinessError('INTERNAL_ERROR');
    }
    return result.body;
  }
}

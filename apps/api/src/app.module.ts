import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CustomerQuotaGuard } from './http/customer-quota';
import { PG_POOL, type Database } from './http/database';
import { ALLOWED_ORIGINS, OriginGuard } from './http/origin.guard';
import { ProblemFilter } from './http/problem.filter';
import { CustomerSessionGuard } from './http/session.guard';
import { HealthController } from './health.controller';
import { GoalsController } from './modules/agreements/goals.controller';
import { GoalSigningController, PIN_PEPPER } from './workflows/goal-signing.controller';
import { BeneficiaryController } from './workflows/beneficiary.controller';
import { BackofficeOversightController } from './workflows/backoffice-oversight.controller';
import { BackofficeSettlementController } from './workflows/backoffice-settlement.controller';
import { BackofficeRefundController, PLATFORM_SIGNING_KEY, type PlatformSigningKey } from './workflows/backoffice-refund.controller';
import { StaffAuthController } from './modules/admin/staff.controller';
import { STAFF_RP, StaffSessionGuard } from './http/staff-session.guard';
import type { RelyingParty } from './modules/admin/webauthn';
import { PublicOfferController } from './workflows/public-offer.controller';
import { QuoteController } from './modules/catalog/quote.controller';
import { AccountSecurityController } from './modules/identity/account-security.controller';
import { DataRightsController } from './modules/identity/data-rights.controller';

export type AppDependencies = {
  readonly database: Database;
  readonly allowedOrigins: ReadonlySet<string>;
  /** Poivre PIN (configuration) ; absent : les actions sous PIN répondent 503. */
  readonly pinPepper?: Uint8Array | null;
  /** Partie de confiance WebAuthn du back-office (D62) ; absente : routes du personnel fermées (503). */
  readonly staffRp?: RelyingParty | null;
  /** Clé de signature des instructions (D5) ; absente : instructions refusées (503). */
  readonly platformSigningKey?: PlatformSigningKey | null;
  /** Contrôleurs supplémentaires (sondes de test uniquement). */
  readonly extraControllers?: readonly Type[];
};

/**
 * Module racine. Les dépendances sont fournies explicitement (main.ts lit
 * l'environnement) : aucune configuration implicite ni valeur par défaut.
 */
@Module({})
export class AppModule {
  public static register(deps: AppDependencies): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, PublicOfferController, QuoteController, AccountSecurityController, DataRightsController, GoalsController, GoalSigningController, BeneficiaryController, StaffAuthController, BackofficeRefundController, BackofficeOversightController, BackofficeSettlementController, ...(deps.extraControllers ?? [])],
      providers: [
        { provide: PG_POOL, useValue: deps.database },
        { provide: PIN_PEPPER, useValue: deps.pinPepper ?? null },
        { provide: STAFF_RP, useValue: deps.staffRp ?? null },
        { provide: PLATFORM_SIGNING_KEY, useValue: deps.platformSigningKey ?? null },
        { provide: ALLOWED_ORIGINS, useValue: deps.allowedOrigins },
        { provide: APP_FILTER, useClass: ProblemFilter },
        { provide: APP_GUARD, useClass: OriginGuard },
        CustomerSessionGuard,
        CustomerQuotaGuard,
        StaffSessionGuard,
      ],
    };
  }
}

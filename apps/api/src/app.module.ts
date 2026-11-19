import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
  type Type,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CorrelationMiddleware } from './observability/correlation';
import { LOG_SINK, type LogSink } from './observability/log';
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
import { AdminController } from './modules/admin/admin.controller';
import { STAFF_RP, StaffSessionGuard } from './http/staff-session.guard';
import { PARTNER_RP, PartnerSessionGuard } from './http/partner-session.guard';
import { PartnerStaffController } from './workflows/partner-staff.controller';
import { BackofficeKycController } from './workflows/backoffice-kyc.controller';
import { LegalNameController } from './workflows/kyc.controller';
import { GoalContributionsController } from './workflows/goal-contributions.controller';
import { GoalClaimsController } from './workflows/goal-claims.controller';
import { HANDOVER_PEPPER, PartnerAuthController, PartnerHandoverController } from './workflows/partner.controller';
import type { RelyingParty } from './modules/admin/webauthn';
import { PublicOfferController } from './workflows/public-offer.controller';
import { QuoteController } from './modules/catalog/quote.controller';
import { AccountSecurityController } from './modules/identity/account-security.controller';
import { DataRightsController } from './modules/identity/data-rights.controller';
import { ProfileController } from './modules/identity/profile.controller';
import { ClientSessionController } from './modules/identity/client-session.controller';
import { OTP_PEPPER, SMS_SENDER, type SmsSender } from './modules/identity/sms.port';
import { ClientAuthController } from './workflows/client-auth.controller';

export type AppDependencies = {
  readonly database: Database;
  readonly allowedOrigins: ReadonlySet<string>;
  /** Poivre PIN (configuration) ; absent : les actions sous PIN répondent 503. */
  readonly pinPepper?: Uint8Array | null;
  /** Partie de confiance WebAuthn du back-office (D62) ; absente : routes du personnel fermées (503). */
  readonly staffRp?: RelyingParty | null;
  /** Partie de confiance WebAuthn du portail partenaire (D63) ; absente : routes partenaires fermées (503). */
  readonly partnerRp?: RelyingParty | null;
  /** Poivre des codes de remise (D45) ; absent : remise au comptoir fermée (503). */
  readonly handoverPepper?: Uint8Array | null;
  /** Clé de signature des instructions (D5) ; absente : instructions refusées (503). */
  readonly platformSigningKey?: PlatformSigningKey | null;
  /** Poivre des codes OTP (C2) ; absent : inscription fermée (503 SMS_UNCONFIGURED). */
  readonly otpPepper?: Uint8Array | null;
  /** Prestataire SMS (C2, D1) ; absent : envoi des codes fermé (503 SMS_UNCONFIGURED). Aucune simulation. */
  readonly smsSender?: SmsSender | null;
  /** Puits de journal (NF-OBS-001) ; absent : aucune ligne n'est écrite. */
  readonly logSink?: LogSink | null;
  /** Contrôleurs supplémentaires (sondes de test uniquement). */
  readonly extraControllers?: readonly Type[];
};

/**
 * Module racine. Les dépendances sont fournies explicitement (main.ts lit
 * l'environnement) : aucune configuration implicite ni valeur par défaut.
 */
@Module({})
export class AppModule implements NestModule {
  /** Corrélation sur toutes les routes, y compris 404 et erreurs. */
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }

  public static register(deps: AppDependencies): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, PublicOfferController, QuoteController, AccountSecurityController, DataRightsController, ProfileController, ClientSessionController, ClientAuthController, GoalsController, GoalSigningController, BeneficiaryController, StaffAuthController, BackofficeRefundController, BackofficeOversightController, BackofficeSettlementController, AdminController, PartnerAuthController, PartnerHandoverController, PartnerStaffController, BackofficeKycController, LegalNameController, GoalContributionsController, GoalClaimsController, ...(deps.extraControllers ?? [])],
      providers: [
        { provide: PG_POOL, useValue: deps.database },
        { provide: PIN_PEPPER, useValue: deps.pinPepper ?? null },
        { provide: OTP_PEPPER, useValue: deps.otpPepper ?? null },
        { provide: SMS_SENDER, useValue: deps.smsSender ?? null },
        { provide: STAFF_RP, useValue: deps.staffRp ?? null },
        { provide: PARTNER_RP, useValue: deps.partnerRp ?? null },
        { provide: HANDOVER_PEPPER, useValue: deps.handoverPepper ?? null },
        { provide: PLATFORM_SIGNING_KEY, useValue: deps.platformSigningKey ?? null },
        { provide: ALLOWED_ORIGINS, useValue: deps.allowedOrigins },
        { provide: LOG_SINK, useValue: deps.logSink ?? null },
        CorrelationMiddleware,
        { provide: APP_FILTER, useClass: ProblemFilter },
        { provide: APP_GUARD, useClass: OriginGuard },
        CustomerSessionGuard,
        CustomerQuotaGuard,
        StaffSessionGuard,
        PartnerSessionGuard,
      ],
    };
  }
}

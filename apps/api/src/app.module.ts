import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PG_POOL, type Database } from './http/database';
import { ALLOWED_ORIGINS, OriginGuard } from './http/origin.guard';
import { ProblemFilter } from './http/problem.filter';
import { CustomerSessionGuard } from './http/session.guard';
import { HealthController } from './health.controller';

export type AppDependencies = {
  readonly database: Database;
  readonly allowedOrigins: ReadonlySet<string>;
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
      controllers: [HealthController, ...(deps.extraControllers ?? [])],
      providers: [
        { provide: PG_POOL, useValue: deps.database },
        { provide: ALLOWED_ORIGINS, useValue: deps.allowedOrigins },
        { provide: APP_FILTER, useClass: ProblemFilter },
        { provide: APP_GUARD, useClass: OriginGuard },
        CustomerSessionGuard,
      ],
    };
  }
}

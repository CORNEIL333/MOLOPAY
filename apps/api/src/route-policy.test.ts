import 'reflect-metadata';
import { GUARDS_METADATA, HEADERS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { CustomerSessionGuard } from './http/session.guard';
import { StaffSessionGuard } from './http/staff-session.guard';

/**
 * Lot 24 / SEC-API : politique transversale des routes, vérifiée sur TOUTES
 * les routes déclarées par l'application (une route ajoutée plus tard est
 * couverte d'office). Une réponse liée à une session ne doit jamais être mise
 * en cache par un intermédiaire ni par le navigateur.
 */
type Route = { readonly name: string; readonly authenticated: boolean; readonly cacheControl: string | undefined; readonly method: number };

function routes(): Route[] {
  const controllers = AppModule.register({ database: {} as never, allowedOrigins: new Set() }).controllers ?? [];
  const found: Route[] = [];
  for (const controller of controllers) {
    const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];
    const prototype = controller.prototype as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[key];
      if (key === 'constructor' || typeof handler !== 'function' || Reflect.getMetadata(PATH_METADATA, handler) === undefined) {
        continue;
      }
      const methodGuards = (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[];
      const headers = (Reflect.getMetadata(HEADERS_METADATA, handler) ?? []) as { name: string; value: string }[];
      found.push({
        name: `${controller.name}.${key}`,
        authenticated: [...classGuards, ...methodGuards].some((guard) => guard === CustomerSessionGuard || guard === StaffSessionGuard),
        cacheControl: headers.find((header) => header.name.toLowerCase() === 'cache-control')?.value,
        method: Reflect.getMetadata(METHOD_METADATA, handler) as number,
      });
    }
  }
  return found;
}

describe('Lot 24 / SEC-API politique de cache des routes', () => {
  it('l’application déclare des routes authentifiées (le test porte sur quelque chose)', () => {
    expect(routes().filter((route) => route.authenticated).length).toBeGreaterThan(10);
  });

  it('toute route authentifiée répond « Cache-Control: private, no-store »', () => {
    const offenders = routes()
      .filter((route) => route.authenticated && route.cacheControl !== 'private, no-store')
      .map((route) => `${route.name} → ${route.cacheControl ?? '(absent)'}`);
    expect(offenders).toEqual([]);
  });
});

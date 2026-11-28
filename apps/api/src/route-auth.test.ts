import 'reflect-metadata';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { PartnerSessionGuard } from './http/partner-session.guard';
import { CustomerSessionGuard } from './http/session.guard';
import { StaffSessionGuard } from './http/staff-session.guard';

/**
 * SEC-AUTHZ (refus par défaut) : chaque route déclarée par l'application est
 * protégée par la session de son espace, d'après son chemin ; les seules
 * routes sans session sont celles de la liste blanche ci-dessous. Une route
 * ajoutée plus tard sans garde, ou avec la garde d'un autre espace, fait
 * échouer ce test.
 */
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];

/** Routes publiques autorisées (méthode + chemin), avec leur raison. */
export const PUBLIC_ROUTES: Readonly<Record<string, string>> = {
  'GET /health': 'sonde de disponibilité, sans donnée',
  'GET /health/ready': 'sonde de disponibilité (base et version du schéma), sans donnée',
  'GET /v1/offers': 'catalogue public (F-CAT-001)',
  'GET /v1/offers/:offerId': 'fiche d’offre publique',
  'GET /v1/plans': 'plans de paiement publics',
  'POST /v1/auth/otp-challenges': 'inscription : envoi du code',
  'POST /v1/auth/signups': 'inscription',
  'POST /v1/auth/device-challenges': 'connexion : défi de l’appareil',
  'POST /v1/auth/sessions': 'connexion du client',
  'POST /v1/auth/session-refreshes': 'renouvellement par jeton de rafraîchissement lié à l’appareil',
  'POST /v1/staff/login-challenges': 'connexion du personnel : défi WebAuthn',
  'POST /v1/staff/sessions': 'connexion du personnel',
  'POST /v1/staff/credentials': 'enrôlement d’une clé d’accès par jeton d’enrôlement à usage unique',
  'DELETE /v1/staff/sessions/current': 'déconnexion (n’agit que sur le cookie présenté)',
  'POST /v1/partner/login-challenges': 'connexion partenaire : défi WebAuthn',
  'POST /v1/partner/sessions': 'connexion partenaire',
  'POST /v1/partner/credentials': 'enrôlement d’une clé d’accès partenaire par jeton à usage unique',
  'DELETE /v1/partner/sessions/current': 'déconnexion (n’agit que sur le cookie présenté)',
};

type Route = { readonly key: string; readonly path: string; readonly guards: readonly unknown[] };

function routes(): Route[] {
  const found: Route[] = [];
  for (const controller of AppModule.register({ database: {} as never, allowedOrigins: new Set() }).controllers ?? []) {
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];
    const prototype = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];
      if (name === 'constructor' || typeof handler !== 'function' || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
      const path = `/${[base, String(Reflect.getMetadata(PATH_METADATA, handler))].filter((part) => part !== '' && part !== '/').join('/')}`.replace(/\/+/g, '/');
      const method = METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? '?';
      found.push({ key: `${method} ${path}`, path, guards: [...classGuards, ...((Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[])] });
    }
  }
  return found;
}

/** Garde de session attendue d'après le chemin ; null : route publique de la liste blanche. */
export function expectedGuard(key: string, path: string): unknown {
  if (key in PUBLIC_ROUTES) return null;
  if (path.startsWith('/v1/backoffice/') || path.startsWith('/v1/staff/')) return StaffSessionGuard;
  if (path.startsWith('/v1/partner/')) return PartnerSessionGuard;
  // Hors liste blanche, une route d'authentification client (ex. déconnexion) exige la session du client.
  if (path.startsWith('/v1/me') || path.startsWith('/v1/goals') || path.startsWith('/v1/auth/') || /^\/v1\/offers\/[^/]+\/quotes$/.test(path)) return CustomerSessionGuard;
  return 'ESPACE_INCONNU';
}

const SESSIONS: readonly unknown[] = [CustomerSessionGuard, StaffSessionGuard, PartnerSessionGuard];

describe('SEC-AUTHZ — chaque route est protégée par la session de son espace (refus par défaut)', () => {
  it('le contrôle porte sur toutes les routes, et chaque route publique de la liste existe vraiment', () => {
    const all = routes();
    expect(all.length).toBeGreaterThan(60);
    const keys = new Set(all.map((route) => route.key));
    expect(Object.keys(PUBLIC_ROUTES).filter((key) => !keys.has(key))).toEqual([]);
  });

  it('aucune route sans session hors liste blanche ; aucune route avec la session d’un autre espace ; aucun espace inconnu', () => {
    const offenders = routes().flatMap((route) => {
      const expected = expectedGuard(route.key, route.path);
      const sessions = route.guards.filter((guard) => SESSIONS.includes(guard));
      if (expected === 'ESPACE_INCONNU') return [`${route.key} : espace inconnu`];
      if (expected === null) return sessions.length === 0 ? [] : [`${route.key} : publique mais gardée`];
      return sessions.length === 1 && sessions[0] === expected ? [] : [`${route.key} : garde attendue ${(expected as { name: string }).name}`];
    });
    expect(offenders).toEqual([]);
  });

  it('refuse (contrôle du contrôle) : une route du back-office sans garde ou avec la garde client est signalée', () => {
    expect(expectedGuard('GET /v1/backoffice/nouvelle', '/v1/backoffice/nouvelle')).toBe(StaffSessionGuard);
    expect(expectedGuard('GET /v1/partner/nouvelle', '/v1/partner/nouvelle')).toBe(PartnerSessionGuard);
    expect(expectedGuard('GET /v1/goals/x', '/v1/goals/x')).toBe(CustomerSessionGuard);
    expect(expectedGuard('GET /v1/autre', '/v1/autre')).toBe('ESPACE_INCONNU');
  });
});

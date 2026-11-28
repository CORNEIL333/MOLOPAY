import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GUARDS_METADATA, HEADERS_METADATA, METHOD_METADATA, PATH_METADATA, SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';
import { AppModule } from './app.module';
import { QUOTA_ACTION } from './http/customer-quota';
import { PARTNER_RP, PartnerSessionGuard } from './http/partner-session.guard';
import { CustomerSessionGuard } from './http/session.guard';
import { STAFF_RP, StaffSessionGuard } from './http/staff-session.guard';
import { PLATFORM_SIGNING_KEY } from './workflows/backoffice-refund.controller';
import { PIN_PEPPER } from './workflows/goal-signing.controller';
import { HANDOVER_PEPPER } from './workflows/partner.controller';

/** Chemin du document versionné (racine du dépôt). */
export const ROUTE_INVENTORY_PATH = 'docs/04_annexes/recette/INVENTAIRE_ROUTES.md';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
const CONFIG_TOKENS: ReadonlyMap<unknown, string> = new Map<unknown, string>([
  [STAFF_RP, 'partie de confiance du personnel'],
  [PARTNER_RP, 'partie de confiance partenaire'],
  [PIN_PEPPER, 'poivre PIN'],
  [PLATFORM_SIGNING_KEY, 'clé de signature des instructions'],
  [HANDOVER_PEPPER, 'poivre des codes de remise'],
]);

type Row = {
  readonly method: string;
  readonly path: string;
  readonly space: 'public' | 'client' | 'personnel' | 'partenaire';
  readonly cache: string;
  readonly idempotency: boolean;
  readonly quota: string;
  readonly config: readonly string[];
  readonly summary: string;
};

type Contract = { paths: Record<string, Record<string, { summary?: string; parameters?: { $ref?: string }[] }>> };

function contract(): Contract {
  return JSON.parse(readFileSync(resolve(__dirname, '../../../packages/contracts/openapi.json'), 'utf8')) as Contract;
}

/**
 * Lot 25 / CDC_07 : inventaire de la surface d'attaque, dérivé du code
 * (routes, gardes, en-têtes, quotas, dépendances de configuration) et du
 * contrat (résumé, Idempotency-Key). Aucun état, aucune donnée.
 */
export function buildRouteInventory(): string {
  const spec = contract();
  const rows: Row[] = [];
  for (const controller of AppModule.register({ database: {} as never, allowedOrigins: new Set() }).controllers ?? []) {
    const base = (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ?? '';
    const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];
    const deps = ((Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, controller) ?? []) as { param: unknown }[]).map((dep) => dep.param);
    const prototype = controller.prototype as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[key];
      if (key === 'constructor' || typeof handler !== 'function' || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
      const method = METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? '?';
      const sub = (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? '';
      const path = `/${[base, sub].filter((part) => part !== '' && part !== '/').join('/')}`.replace(/\/+/g, '/').replace(/:([A-Za-z]+)/g, '{$1}');
      const guards = [...classGuards, ...((Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[])];
      const space = guards.includes(StaffSessionGuard) ? 'personnel' : guards.includes(PartnerSessionGuard) ? 'partenaire' : guards.includes(CustomerSessionGuard) ? 'client' : 'public';
      const headers = (Reflect.getMetadata(HEADERS_METADATA, handler) ?? []) as { name: string; value: string }[];
      const operation = spec.paths[path]?.[method.toLowerCase()];
      const config = new Set<string>();
      for (const dep of deps) {
        const label = CONFIG_TOKENS.get(dep);
        if (label !== undefined) config.add(label);
      }
      if (space === 'personnel') config.add('partie de confiance du personnel');
      if (space === 'partenaire') config.add('partie de confiance partenaire');
      rows.push({
        method,
        path,
        space,
        cache: headers.find((header) => header.name.toLowerCase() === 'cache-control')?.value ?? '(défaut)',
        idempotency: (operation?.parameters ?? []).some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey'),
        quota: (Reflect.getMetadata(QUOTA_ACTION, handler) as string | undefined) ?? '—',
        config: [...config].sort(),
        summary: (operation?.summary ?? '(absente du contrat)').replace(/\|/g, '/'),
      });
    }
  }
  rows.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
  const unsafe = (method: string): boolean => method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const lines = [
    '# Inventaire des routes de l’API (recette, tests d’intrusion)',
    '',
    '> **Généré** par `pnpm routes:inventory` depuis le code et le contrat OpenAPI ; ne pas modifier à la main.',
    '> Un test unitaire échoue si ce document ne correspond plus au code.',
    '',
    '- **Espace** : `public` (sans session), `client` (cookie `client_session`), `personnel` (cookie `staff_session`, WebAuthn, ADR-0007 proposé), `partenaire` (cookie `partner_session`, WebAuthn, D63).',
    '- **Origin** : toute méthode non sûre exige un en-tête `Origin` en liste blanche (garde globale).',
    '- **Fermée sans** : configuration absente ⇒ la route répond 503 (fermée par défaut).',
    `- **${rows.length.toString()} routes.**`,
    '',
    '| Méthode | Chemin | Espace | Cache-Control | Origin | Idempotency-Key | Quota | Fermée sans | Résumé |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((row) =>
      `| \`${row.method}\` | \`${row.path}\` | ${row.space} | ${row.cache} | ${unsafe(row.method) ? 'oui' : 'non'} | ${row.idempotency ? 'oui' : 'non'} | ${row.quota} | ${row.config.length === 0 ? '—' : row.config.join(', ')} | ${row.summary} |`,
    ),
    '',
  ];
  return lines.join('\n');
}

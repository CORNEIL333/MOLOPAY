import { BusinessError } from '@achat/contracts';

/**
 * SEC-MOB-005 : version minimale de l'application imposée par le serveur, pour
 * retirer vite une version vulnérable. L'application déclare
 * `X-Client-Version: <plateforme>/<majeur>.<mineur>.<correctif>` ; le minimum
 * par plateforme est un paramètre versionné publié à deux personnes
 * (`client_min_versions`, ex. `{"mobile":"0.2.0"}`). Sans en-tête (navigateur)
 * ou sans minimum publié pour la plateforme : rien n'est bloqué.
 */
export const CLIENT_VERSION_SETTING_KEY = 'client_min_versions';
export const CLIENT_PLATFORMS = ['mobile', 'desktop'] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];
export type Semver = readonly [number, number, number];
export type MinimumVersions = Readonly<Partial<Record<ClientPlatform, Semver>>>;

const HEADER = /^(mobile|desktop)\/(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$/;
const VERSION = /^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$/;

export function parseClientVersion(header: unknown): { readonly platform: ClientPlatform; readonly version: Semver } | null {
  if (header === undefined) return null;
  const match = typeof header === 'string' ? HEADER.exec(header) : null;
  if (match === null) throw new BusinessError('REQUEST_INVALID', 'En-tête X-Client-Version invalide');
  return { platform: match[1] as ClientPlatform, version: [Number(match[2]), Number(match[3]), Number(match[4])] };
}

/** Valeur du paramètre ; toute forme inattendue est ignorée en entier (rien de bloqué par erreur de saisie). */
export function parseMinimumVersions(value: unknown): MinimumVersions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Partial<Record<ClientPlatform, Semver>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const match = typeof raw === 'string' ? VERSION.exec(raw) : null;
    if (!(CLIENT_PLATFORMS as readonly string[]).includes(key) || match === null) return {};
    out[key as ClientPlatform] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  return out;
}

export function isBelow(version: Semver, minimum: Semver): boolean {
  for (let index = 0; index < 3; index += 1) {
    if ((version[index] ?? 0) !== (minimum[index] ?? 0)) return (version[index] ?? 0) < (minimum[index] ?? 0);
  }
  return false;
}

export function assertSupportedClient(header: unknown, minimums: MinimumVersions): void {
  const declared = parseClientVersion(header);
  if (declared === null) return;
  const minimum = minimums[declared.platform];
  if (minimum !== undefined && isBelow(declared.version, minimum)) {
    throw new BusinessError('CLIENT_UPGRADE_REQUIRED', `Version ${minimum.join('.')} ou plus récente exigée`);
  }
}

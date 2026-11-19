import { BusinessError } from '@achat/contracts';
import type { IssuedSession } from './domain';
import { parseSessionCookie, sessionCookieValue } from './session.store';

/**
 * SEC-AUTH-001 / C2 : cookies de la session client.
 * - `client_session` : `<sessionId>.<jeton d'accès>`, envoyé à toute l'application (`Path=/`), durée de l'accès ;
 * - `client_refresh` : `<sessionId>.<jeton de rafraîchissement>`, restreint aux routes d'authentification
 *   (`Path=/v1/auth`, `SameSite=Strict`), durée de la fenêtre de rafraîchissement.
 * Les deux sont `HttpOnly; Secure` : jamais lisibles par le JavaScript de la page.
 */
export const REFRESH_COOKIE = 'client_refresh';
const REFRESH_PATH = '/v1/auth';

function seconds(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
}

export function issuedSessionCookies(issued: IssuedSession): readonly string[] {
  const { session } = issued;
  return [
    `client_session=${sessionCookieValue(session.id, issued.accessToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds(session.accessIssuedAt, session.accessExpiresAt).toString()}`,
    `${REFRESH_COOKIE}=${sessionCookieValue(session.id, issued.refreshToken)}; Path=${REFRESH_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds(session.accessIssuedAt, session.refreshExpiresAt).toString()}`,
  ];
}

/** Effacement des deux cookies (déconnexion, blocage), y compris l'ancien chemin du rafraîchissement. */
export const CLEARED_SESSION_COOKIES: readonly string[] = [
  ['client_session', '/'], [REFRESH_COOKIE, '/'], [REFRESH_COOKIE, REFRESH_PATH],
].map(([name, path]) => `${name ?? ''}=; Path=${path ?? '/'}; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);

/** Lit l'unique cookie `client_refresh` ; absent, dupliqué ou illisible : IDENTITY_SESSION_INVALID. */
export function readRefreshCookie(header: string | undefined): { readonly sessionId: string; readonly refreshToken: string } {
  const values = typeof header === 'string' && header.length <= 8192
    ? header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${REFRESH_COOKIE}=`)).map((part) => part.slice(REFRESH_COOKIE.length + 1))
    : [];
  if (values.length !== 1) {
    throw new BusinessError('IDENTITY_SESSION_INVALID', 'Session absente');
  }
  const parsed = parseSessionCookie(values[0]);
  return { sessionId: parsed.sessionId, refreshToken: parsed.accessToken };
}

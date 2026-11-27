/** Forme minimale de la réponse Express utilisée ici (pas de dépendance de types supplémentaire). */
type HeaderResponse = { setHeader(name: string, value: string): unknown; removeHeader(name: string): void };

/**
 * SEC-CRY-001 (HSTS) / SEC-API-005 : en-têtes de sécurité posés sur TOUTE
 * réponse de l'API (succès, problème, route inconnue), avant tout traitement.
 * L'API ne sert que du JSON : aucune ressource ne doit être chargée, encadrée
 * ni référencée par un navigateur. Le cadriciel n'est pas annoncé.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

export function securityHeaders(_request: unknown, response: HeaderResponse, next: () => void): void {
  response.removeHeader('X-Powered-By');
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
  next();
}

export type CspOptions = {
  readonly nonce: string;
  readonly development: boolean;
};

export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * SEC-API-005 : CSP stricte à nonce par requête (même modèle que le client
 * web) : aucun script ni style tiers, aucun eval en production, aucune
 * connexion hors de l'origine, aucun cadre. Ni service worker ni manifest.
 */
export function buildContentSecurityPolicy({ nonce, development }: CspOptions): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (development) {
    scriptSrc.push("'unsafe-eval'");
  }
  const connectSrc = ["'self'"];
  if (development) {
    connectSrc.push('ws:');
  }
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'none'",
    "manifest-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ];
  if (!development) {
    directives.push('upgrade-insecure-requests');
  }
  return directives.join('; ');
}

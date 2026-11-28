export type CspOptions = {
  readonly nonce: string;
  readonly development: boolean;
};

export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * CSP stricte : aucun script tiers, aucun eval en production, aucune
 * connexion sortante. Le service worker et le manifest restent locaux.
 */
export function buildContentSecurityPolicy({
  nonce,
  development,
}: CspOptions): string {
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
    "style-src-attr 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
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

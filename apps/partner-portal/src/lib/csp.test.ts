import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, createNonce } from './csp';

describe('SEC-API-005 buildContentSecurityPolicy', () => {
  it('production : aucun script tiers, aucun eval, aucun cadre, aucune connexion hors de l’origine', () => {
    const csp = buildContentSecurityPolicy({ nonce: 'abc123', development: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("style-src 'self' 'nonce-abc123'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("worker-src 'none'");
    expect(csp).toContain("manifest-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('ws:');
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toMatch(/https?:\/\//);
  });

  it('assouplit seulement le développement local', () => {
    const csp = buildContentSecurityPolicy({ nonce: 'dev', development: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain('ws:');
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('ne produit jamais deux fois le même nonce', () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});

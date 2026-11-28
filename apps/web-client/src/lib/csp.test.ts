import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, createNonce } from './csp';

describe('buildContentSecurityPolicy', () => {
  it('n’autorise aucun script tiers et bloque les cadres', () => {
    const csp = buildContentSecurityPolicy({
      nonce: 'abc123',
      development: false,
    });
    expect(csp).toContain("nonce-abc123");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('ws:');
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toMatch(/https?:\/\//);
  });

  it('assouplit seulement le développement local', () => {
    const csp = buildContentSecurityPolicy({
      nonce: 'dev',
      development: true,
    });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain('ws:');
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('ne produit jamais deux fois le même nonce', () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});

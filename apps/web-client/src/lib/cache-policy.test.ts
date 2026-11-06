import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cacheStrategy, isStaticAsset, OFFLINE_PATH, STATIC_ASSET_PATHS, STATIC_ASSET_PREFIXES } from './cache-policy';

const script = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

describe('cache PWA sans HTML dynamique ni données privées', () => {
  it('ne stocke aucune navigation, même catalogue public à nonce CSP', () => {
    for (const path of ['/', '/offres/abc', '/objectifs', '/objectifs/abc', '/connexion', '/langue/en', '/compte', '/compte/donnees']) {
      expect(cacheStrategy('GET', 'navigate', path)).toBe('network-only');
      expect(isStaticAsset(path)).toBe(false);
    }
  });
  it('refuse toutes les actions financières et les lectures API', () => {
    for (const path of ['/v1/goals', '/v1/offers', '/v1/me', '/v1/goals/abc/contributions', '/v1/admin/ledger/entries',
      '/v1/me/security', '/v1/me/security/block', '/v1/me/security/revoke-other-sessions', '/v1/auth/signouts', '/v1/me/data-rights']) {
      expect(cacheStrategy('GET', 'cors', path)).toBe('bypass');
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(cacheStrategy(method, 'navigate', path)).toBe('bypass');
        expect(cacheStrategy(method, 'cors', '/icon.svg')).toBe('bypass');
      }
    }
  });
  it('autorise uniquement la coquille statique', () => {
    for (const path of [...STATIC_ASSET_PATHS, '/_next/static/chunks/app.js']) {
      expect(isStaticAsset(path)).toBe(true);
      expect(cacheStrategy('GET', 'cors', path)).toBe('cache-first');
    }
  });
  it('aligne le worker et exige cache public, réponse non redirigée et même origine', () => {
    expect(script).toContain(`const STATIC_ASSET_PATHS = ${JSON.stringify(STATIC_ASSET_PATHS)};`);
    expect(script).toContain(`const STATIC_ASSET_PREFIXES = ${JSON.stringify(STATIC_ASSET_PREFIXES)};`);
    expect(script).toContain(`const OFFLINE_PATH = ${JSON.stringify(OFFLINE_PATH)};`);
    expect(script).toContain("request.method !== 'GET'");
    expect(script).toContain("request.mode === 'navigate'");
    expect(script).toContain('!response.redirected');
    expect(script).toContain('no-store|private');
    expect(script).toContain('url.origin !== worker.location.origin');
  });
});

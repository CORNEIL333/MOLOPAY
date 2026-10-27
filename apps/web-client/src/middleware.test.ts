import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

it('transmet exactement la CSP au rendu et refuse le cache des pages', () => {
  const response = middleware(new NextRequest('http://localhost:3100/connexion'));
  const csp = response.headers.get('Content-Security-Policy');
  expect(csp).toContain("'strict-dynamic'");
  expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
  expect(csp).toContain(`nonce-${response.headers.get('x-middleware-request-x-nonce') ?? ''}`);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});

describe('nonce par requête', () => {
  it('ne réutilise pas le nonce fourni par le navigateur', () => {
    const request = new NextRequest('http://localhost:3100/', { headers: { 'x-nonce': 'untrusted' } });
    const first = middleware(request);
    const second = middleware(request);
    expect(first.headers.get('Content-Security-Policy')).not.toContain('untrusted');
    expect(first.headers.get('Content-Security-Policy')).not.toBe(second.headers.get('Content-Security-Policy'));
  });
});

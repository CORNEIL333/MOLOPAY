import { describe, expect, it } from 'vitest';
import { buildDeviceChallengeMessage } from './client-auth';

describe('Contrat 0.35.0 / D71 / SEC-AUTH-005 — buildDeviceChallengeMessage', () => {
  it('construit un message séparé par domaine pour LOGIN et REFRESH', () => {
    const challengeB64Url = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';
    const loginMsg = buildDeviceChallengeMessage(
      'LOGIN',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      challengeB64Url,
    );
    const refreshMsg = buildDeviceChallengeMessage(
      'REFRESH',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      challengeB64Url,
    );

    const expectedLoginPrefix = new TextEncoder().encode(
      'molopay.client-login.v1\u000011111111-1111-4111-8111-111111111111\u000022222222-2222-4222-8222-222222222222\u0000',
    );
    const expectedRefreshPrefix = new TextEncoder().encode(
      'molopay.client-refresh.v1\u000011111111-1111-4111-8111-111111111111\u000022222222-2222-4222-8222-222222222222\u0000',
    );

    expect(loginMsg.length).toBe(expectedLoginPrefix.length + 32);
    expect(Array.from(loginMsg.slice(0, expectedLoginPrefix.length))).toEqual(
      Array.from(expectedLoginPrefix),
    );
    expect(Array.from(refreshMsg.slice(0, expectedRefreshPrefix.length))).toEqual(
      Array.from(expectedRefreshPrefix),
    );
    expect(loginMsg.slice(expectedLoginPrefix.length)[0]).toBe(1);
    expect(loginMsg.slice(expectedLoginPrefix.length)[31]).toBe(32);
  });
});

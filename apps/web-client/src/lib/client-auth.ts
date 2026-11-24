import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { browserApi } from './browser-api';
import { problemFrom } from './problem';

export type OtpChallenge = components['schemas']['OtpChallenge'];
export type SignupRequest = components['schemas']['SignupRequest'];
export type SignupResult = components['schemas']['SignupResult'];
export type ClientLoginChallenge = components['schemas']['ClientLoginChallenge'];
export type ClientLoginResult = components['schemas']['ClientLoginResult'];
export type ClientSessionRefresh = components['schemas']['ClientSessionRefresh'];
export type DeviceChallengePurpose = components['schemas']['DeviceChallengeRequest']['purpose'];

export type ClientAuthOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: ProblemSummary };

const CONTEXTS: Readonly<Record<DeviceChallengePurpose, string>> = {
  LOGIN: 'molopay.client-login.v1',
  REFRESH: 'molopay.client-refresh.v1',
};

function decodeBase64Url(encoded: string): Uint8Array {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Contrat 0.35.0 (D71 / SEC-AUTH-005) :
 * UTF-8 de `<contexte>\u0000<challengeId>\u0000<deviceId>\u0000` suivi des 32 octets du défi décodé base64url.
 */
export function buildDeviceChallengeMessage(
  purpose: DeviceChallengePurpose,
  challengeId: string,
  deviceId: string,
  challengeBase64Url: string,
): Uint8Array {
  const prefix = new TextEncoder().encode(
    `${CONTEXTS[purpose]}\u0000${challengeId}\u0000${deviceId}\u0000`,
  );
  const challengeBytes = decodeBase64Url(challengeBase64Url);
  const combined = new Uint8Array(prefix.length + challengeBytes.length);
  combined.set(prefix, 0);
  combined.set(challengeBytes, prefix.length);
  return combined;
}

export async function requestSignupOtp(
  phone: string,
  fallbackTitle: string,
): Promise<ClientAuthOutcome<OtpChallenge>> {
  const response = await browserApi().POST('/v1/auth/otp-challenges', {
    params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    body: { phone, purpose: 'SIGNUP' },
    cache: 'no-store',
  });
  if (response.data !== undefined) {
    return { ok: true, value: response.data };
  }
  return { ok: false, problem: problemFrom(response.error, response.response, fallbackTitle) };
}

export async function completeSignup(
  input: SignupRequest,
  fallbackTitle: string,
): Promise<ClientAuthOutcome<SignupResult>> {
  const response = await browserApi().POST('/v1/auth/signups', {
    params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    body: input,
    cache: 'no-store',
  });
  if (response.data !== undefined) {
    return { ok: true, value: response.data };
  }
  return { ok: false, problem: problemFrom(response.error, response.response, fallbackTitle) };
}

export async function loginWithDevice(
  input: {
    readonly deviceId: string;
    readonly pin: string;
    readonly signMessage: (message: Uint8Array) => Promise<string>;
  },
  fallbackTitle: string,
): Promise<ClientAuthOutcome<ClientLoginResult>> {
  const api = browserApi();
  const challengeRes = await api.POST('/v1/auth/device-challenges', {
    params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    body: { deviceId: input.deviceId, purpose: 'LOGIN' },
    cache: 'no-store',
  });
  if (challengeRes.data === undefined) {
    return {
      ok: false,
      problem: problemFrom(challengeRes.error, challengeRes.response, fallbackTitle),
    };
  }
  const message = buildDeviceChallengeMessage(
    'LOGIN',
    challengeRes.data.challengeId,
    input.deviceId,
    challengeRes.data.challenge,
  );
  const signature = await input.signMessage(message);
  const sessionRes = await api.POST('/v1/auth/sessions', {
    params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    body: {
      challengeId: challengeRes.data.challengeId,
      deviceId: input.deviceId,
      signature,
      pin: input.pin,
    },
    cache: 'no-store',
  });
  if (sessionRes.data !== undefined) {
    return { ok: true, value: sessionRes.data };
  }
  return {
    ok: false,
    problem: problemFrom(sessionRes.error, sessionRes.response, fallbackTitle),
  };
}

export async function refreshWithDevice(
  input: {
    readonly deviceId: string;
    readonly signMessage: (message: Uint8Array) => Promise<string>;
  },
  fallbackTitle: string,
): Promise<ClientAuthOutcome<ClientSessionRefresh>> {
  const api = browserApi();
  const challengeRes = await api.POST('/v1/auth/device-challenges', {
    params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    body: { deviceId: input.deviceId, purpose: 'REFRESH' },
    cache: 'no-store',
  });
  if (challengeRes.data === undefined) {
    return {
      ok: false,
      problem: problemFrom(challengeRes.error, challengeRes.response, fallbackTitle),
    };
  }
  const message = buildDeviceChallengeMessage(
    'REFRESH',
    challengeRes.data.challengeId,
    input.deviceId,
    challengeRes.data.challenge,
  );
  const signature = await input.signMessage(message);
  const refreshRes = await api.POST('/v1/auth/session-refreshes', {
    params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    body: { challengeId: challengeRes.data.challengeId, signature },
    cache: 'no-store',
  });
  if (refreshRes.data !== undefined) {
    return { ok: true, value: refreshRes.data };
  }
  return {
    ok: false,
    problem: problemFrom(refreshRes.error, refreshRes.response, fallbackTitle),
  };
}

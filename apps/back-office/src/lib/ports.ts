import { createApiClient } from '@achat/contracts/client';
import type { StaffLoginPorts } from '../components/staff-login';
import type { WorkQueuePorts } from '../components/work-queue';

/** Client navigateur : même origine (réécriture vers l'API), cookie de session httpOnly. */
function api(): ReturnType<typeof createApiClient> {
  return createApiClient({ baseUrl: '' });
}

function problemOf(error: unknown, status: number): { readonly title: string; readonly detail?: string } {
  const body = (typeof error === 'object' && error !== null ? error : {}) as { title?: unknown; detail?: unknown };
  return {
    title: typeof body.title === 'string' ? body.title : `Erreur ${status.toString()}`,
    ...(typeof body.detail === 'string' ? { detail: body.detail } : {}),
  };
}

/** Connexion : routes réelles (D62) et authentificateur WebAuthn du navigateur, vérification de l'utilisateur exigée. */
export const browserStaffLoginPorts: StaffLoginPorts = {
  async requestChallenge(login) {
    const result = await api().POST('/v1/staff/login-challenges', {
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: { login },
      cache: 'no-store',
    });
    return result.data === undefined
      ? { ok: false, problem: problemOf(result.error, result.response.status) }
      : { ok: true, challengeId: result.data.challengeId, challenge: result.data.challenge, rpId: result.data.rpId };
  },
  async getAssertion({ challenge, rpId }) {
    const credential = await navigator.credentials.get({
      publicKey: { challenge: new Uint8Array(challenge), rpId, userVerification: 'required', timeout: 60_000 },
    });
    if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAssertionResponse)) {
      throw new Error('ASSERTION_MISSING');
    }
    return {
      credentialId: new Uint8Array(credential.rawId),
      clientDataJSON: new Uint8Array(credential.response.clientDataJSON),
      authenticatorData: new Uint8Array(credential.response.authenticatorData),
      signature: new Uint8Array(credential.response.signature),
    };
  },
  async openSession(body) {
    const result = await api().POST('/v1/staff/sessions', {
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
      body,
      cache: 'no-store',
    });
    return result.response.status === 201 ? { ok: true } : { ok: false, problem: problemOf(result.error, result.response.status) };
  },
};

export const browserWorkQueuePorts: WorkQueuePorts = {
  async loadQueue(reason) {
    const result = await api().GET('/v1/backoffice/queue', { params: { query: { reason } }, cache: 'no-store' });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, queue: result.data };
  },
};

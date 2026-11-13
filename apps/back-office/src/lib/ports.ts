import { createApiClient } from '@achat/contracts/client';
import type { StaffLoginPorts } from '../components/staff-login';
import type { FundsActionPort } from '../components/funds-action';
import type { OversightPort } from '../components/oversight-action';
import type { WorkQueuePorts } from '../components/work-queue';

/** Client navigateur : même origine (réécriture vers l'API), cookie de session httpOnly. */
function api(): ReturnType<typeof createApiClient> {
  return createApiClient({ baseUrl: '' });
}

function problemOf(error: unknown, status: number): { readonly title: string; readonly detail?: string; readonly status: number } {
  const body = (typeof error === 'object' && error !== null ? error : {}) as { title?: unknown; detail?: unknown };
  return {
    title: typeof body.title === 'string' ? body.title : `Erreur ${status.toString()}`,
    status,
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

/** POST vers une route réelle du back-office (même origine), une clé d'idempotence par intention. */
async function postAction(path: string, body: Readonly<Record<string, string>>): Promise<{ readonly ok: true } | { readonly ok: false; readonly problem: { readonly title: string; readonly detail?: string; readonly status: number } }> {
  if (!path.startsWith('/v1/backoffice/')) {
    throw new Error('ROUTE_NOT_ALLOWED');
  }
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (response.ok) {
    return { ok: true };
  }
  return { ok: false, problem: problemOf(await response.json().catch(() => ({})), response.status) };
}

const act: FundsActionPort = ({ flow, id, step, body }) => postAction(`/v1/backoffice/${flow}/${encodeURIComponent(id)}/${step}`, body);
const oversee: OversightPort = ({ path, body }) => postAction(path, body);

export const browserWorkQueuePorts: WorkQueuePorts = {
  act,
  oversee,
  async loadQueue(reason) {
    const result = await api().GET('/v1/backoffice/queue', { params: { query: { reason } }, cache: 'no-store' });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, queue: result.data };
  },
};

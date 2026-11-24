import { createApiClient } from '@achat/contracts/client';
import type { StaffLoginPorts } from '../components/staff-login';
import type { AdminPort } from '../components/admin-panel';
import type { FundsActionPort } from '../components/funds-action';
import type { StaffEnrollmentPorts } from '../components/staff-enrollment';
import type { OversightPort } from '../components/oversight-action';
import type { WorkQueuePorts } from '../components/work-queue';
import type { ComplaintPorts as ComplaintPort } from '../components/complaint-detail';
import type { SanctionsPorts as SanctionsPort } from '../components/sanctions-panel';
import type { DashboardPorts as DashboardPort } from '../components/dashboard-board';
import type { CustomerBlockPorts } from '../components/customer-block';
import type { GoalHistoryPorts } from '../components/goal-history';
import type { OutgoingFreezePorts } from '../components/outgoing-freeze';

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

/** Administration : routes réelles `/v1/backoffice/admin/`, corps de réponse rendu à l'écran (jeton affiché une fois, jamais stocké ici). */
export const browserAdminPort: AdminPort = async ({ path, body }) => {
  if (!path.startsWith('/v1/backoffice/admin/')) {
    throw new Error('ROUTE_NOT_ALLOWED');
  }
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return response.ok ? { ok: true, body: json } : { ok: false, problem: problemOf(json, response.status) };
};

/** Enrôlement : création de la clé par l'authentificateur (ES256 ou EdDSA, vérification exigée) et route réelle. */
export const browserStaffEnrollmentPorts: StaffEnrollmentPorts = {
  async createCredential({ challenge, login }) {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: new Uint8Array(challenge),
        rp: { id: window.location.hostname, name: 'Back-office MoloPay' },
        user: { id: new TextEncoder().encode(login), name: login, displayName: login },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }],
        authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
        attestation: 'none',
        timeout: 60_000,
      },
    });
    if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAttestationResponse)) {
      throw new Error('CREDENTIAL_MISSING');
    }
    const publicKey = credential.response.getPublicKey();
    if (publicKey === null) {
      throw new Error('PUBLIC_KEY_MISSING');
    }
    return {
      credentialId: new Uint8Array(credential.rawId),
      clientDataJSON: new Uint8Array(credential.response.clientDataJSON),
      authenticatorData: new Uint8Array(credential.response.getAuthenticatorData()),
      publicKeySpki: new Uint8Array(publicKey),
    };
  },
  async register(body) {
    const response = await fetch('/v1/staff/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    return response.ok ? { ok: true } : { ok: false, problem: problemOf(await response.json().catch(() => ({})), response.status) };
  },
};

/** F-BO-003 / D65 : tableau de bord agrégé (route réelle ; le motif est inscrit à l'audit). */
export const browserDashboardPorts: DashboardPort = {
  async load(reason) {
    const result = await api().GET('/v1/backoffice/dashboard', { params: { query: { reason } }, cache: 'no-store' });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, board: result.data };
  },
};

/** REG-LBC-002 / D66 : filtrage et examen par les routes réelles du back-office. */
export const browserSanctionsPorts: SanctionsPort = {
  async screen(partnerId) {
    const result = await api().POST('/v1/backoffice/partners/{partnerId}/screenings', {
      params: { path: { partnerId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: {},
      cache: 'no-store',
    });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, screening: result.data };
  },
  async review(screeningId, decision, reason) {
    const result = await api().POST('/v1/backoffice/screenings/{screeningId}/review', {
      params: { path: { screeningId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: { decision, reason },
      cache: 'no-store',
    });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, status: result.data.status };
  },
  async detail(screeningId, reason) {
    const result = await api().GET('/v1/backoffice/screenings/{screeningId}', { params: { path: { screeningId }, query: { reason } }, cache: 'no-store' });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, detail: result.data };
  },
};

/** F-SUP-001 / D73 : détail d'une réclamation (route réelle ; le motif est inscrit à l'audit). */
export const browserComplaintPorts: ComplaintPort = {
  async load(complaintId, reason) {
    const result = await api().GET('/v1/backoffice/complaints/{complaintId}', { params: { path: { complaintId }, query: { reason } }, cache: 'no-store' });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, complaint: result.data };
  },
  async openDispute(complaintId) {
    const result = await api().POST('/v1/backoffice/complaints/{complaintId}/disputes', {
      params: { path: { complaintId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: {},
      cache: 'no-store',
    });
    const disputeId = (result.data as { disputeId?: unknown } | undefined)?.disputeId;
    return typeof disputeId === 'string' ? { ok: true, disputeId } : { ok: false, problem: problemOf(result.error, result.response.status) };
  },
};

/** C4 / F-ACC-006 : blocage d'un compte client par la route réelle ; une clé d'idempotence par confirmation. */
export const browserCustomerBlockPorts: CustomerBlockPorts = {
  async block(accountId, reason) {
    const result = await api().POST('/v1/backoffice/customers/{accountId}/block', {
      params: { path: { accountId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: { reason },
      cache: 'no-store',
    });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, blockedAt: result.data.blockedAt };
  },
};

/** C6 / F-SUP-003 : historique d'un objectif (route réelle ; le motif est inscrit à l'audit). */
export const browserGoalHistoryPorts: GoalHistoryPorts = {
  async load(goalId, reason) {
    const result = await api().GET('/v1/backoffice/goals/{goalId}/history', { params: { path: { goalId }, query: { reason } }, cache: 'no-store' });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, history: result.data };
  },
};

/** C6 : déconnexion du personnel (révocation immédiate côté serveur). */
export async function browserStaffSignOut(): Promise<void> {
  await api().DELETE('/v1/staff/sessions/current', { params: { header: { 'Idempotency-Key': crypto.randomUUID() } }, cache: 'no-store' });
}

/** C7 / SEC-INC-003 : gel des flux sortants par les routes réelles. */
export const browserOutgoingFreezePorts: OutgoingFreezePorts = {
  async load() {
    const result = await api().GET('/v1/backoffice/outgoing-freeze', { cache: 'no-store' });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, state: result.data };
  },
  async request(action, reason) {
    const result = await api().POST('/v1/backoffice/outgoing-freeze/requests', {
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: { action, reason },
      cache: 'no-store',
    });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true };
  },
  async confirm(requestId) {
    const result = await api().POST('/v1/backoffice/outgoing-freeze/requests/{requestId}/confirmation', {
      params: { path: { requestId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: {},
      cache: 'no-store',
    });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true };
  },
};


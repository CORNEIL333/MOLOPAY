import { createApiClient } from '@achat/contracts/client';
import type { CounterHandoverPorts } from '../components/counter-handover';
import type { PartnerEnrollmentPorts } from '../components/partner-enrollment';
import type { PartnerLoginPorts } from '../components/partner-login';
import type { BoardPorts } from '../components/partner-boards';
import type { SellersPorts } from '../components/sellers-panel';
import type { OffersPorts } from '../components/offers-board';

/** Client navigateur : même origine (réécriture vers l'API), cookie `partner_session` httpOnly. */
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

/** D63 : connexion par les routes réelles et l'authentificateur du navigateur, vérification de l'utilisateur exigée. */
export const browserPartnerLoginPorts: PartnerLoginPorts = {
  async requestChallenge(login) {
    const result = await api().POST('/v1/partner/login-challenges', {
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
    const result = await api().POST('/v1/partner/sessions', {
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
      body,
      cache: 'no-store',
    });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, role: result.data.role };
  },
};

/** Enrôlement : clé créée par l'authentificateur (ES256 ou EdDSA, vérification exigée) puis route réelle. */
export const browserPartnerEnrollmentPorts: PartnerEnrollmentPorts = {
  async createCredential({ challenge, login }) {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: new Uint8Array(challenge),
        rp: { id: window.location.hostname, name: 'Portail partenaire MoloPay' },
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
    const result = await api().POST('/v1/partner/credentials', {
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
      body,
      cache: 'no-store',
    });
    return result.response.status === 201 ? { ok: true } : { ok: false, problem: problemOf(result.error, result.response.status) };
  },
};

/** F-SET-001 : position du comptoir (haute précision, jamais en cache) et route réelle de remise. */
export const browserCounterPorts: CounterHandoverPorts = {
  locate() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => { resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }); },
        (error) => { reject(new Error(`GEOLOCATION_${error.code.toString()}`)); },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
      );
    });
  },
  async confirm(body) {
    const result = await api().POST('/v1/partner/handovers', {
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
      body,
      cache: 'no-store',
    });
    return result.data === undefined
      ? { ok: false, problem: problemOf(result.error, result.response.status) }
      : { ok: true, agreementId: result.data.agreementId, validatedAt: result.data.validatedAt };
  },
};

/** F-PRT-004 : lectures réelles du portail (le serveur filtre par partenaire et par rôle). */
export const browserBoardPorts: BoardPorts = {
  async loadOrders() {
    const result = await api().GET('/v1/partner/orders', { cache: 'no-store' });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, rows: result.data.orders };
  },
  async loadPayouts() {
    const result = await api().GET('/v1/partner/payouts', { cache: 'no-store' });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, rows: result.data.payouts };
  },
};

function idempotent(): { readonly header: { readonly 'Idempotency-Key': string } } {
  return { header: { 'Idempotency-Key': crypto.randomUUID() } };
}

/** F-PRT-003 : gestion des vendeurs par les routes réelles ; le jeton d'enrôlement n'est jamais conservé ici. */
export const browserSellersPorts: SellersPorts = {
  async load() {
    const result = await api().GET('/v1/partner/users', { cache: 'no-store' });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, users: result.data.users };
  },
  async create(login) {
    const result = await api().POST('/v1/partner/sellers', { params: idempotent(), body: { login }, cache: 'no-store' });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, sellerId: result.data.sellerId };
  },
  async issueEnrollment(sellerId) {
    const result = await api().POST('/v1/partner/sellers/{sellerId}/enrollments', { params: { path: { sellerId }, ...idempotent() }, body: {}, cache: 'no-store' });
    return result.data === undefined
      ? { ok: false, problem: problemOf(result.error, result.response.status) }
      : { ok: true, challengeId: result.data.challengeId, challenge: result.data.challenge, ...(result.data.enrollmentToken === undefined ? {} : { enrollmentToken: result.data.enrollmentToken }) };
  },
  async disable(sellerId, reason) {
    const result = await api().POST('/v1/partner/sellers/{sellerId}/disable', { params: { path: { sellerId }, ...idempotent() }, body: { reason }, cache: 'no-store' });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true };
  },
};

/** Rôle de la session courante (route réelle) ; null si la session est absente ou expirée. */
export async function loadPartnerRole(): Promise<'MANAGER' | 'SELLER' | null> {
  const result = await api().GET('/v1/partner/sessions/current', { cache: 'no-store' });
  return result.data === undefined ? null : result.data.role;
}

/** F-PRT-002 : offres du partenaire (lecture). */
export const browserOffersPorts: OffersPorts = {
  async load() {
    const result = await api().GET('/v1/partner/offers', { cache: 'no-store' });
    return result.data === undefined ? { ok: false, problem: problemOf(result.error, result.response.status) } : { ok: true, rows: result.data.offers };
  },
};

/** Déconnexion : révocation immédiate de la session côté serveur. */
export async function signOutPartner(): Promise<void> {
  await api().DELETE('/v1/partner/sessions/current', { params: idempotent(), cache: 'no-store' });
}

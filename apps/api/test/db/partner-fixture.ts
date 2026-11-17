import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type { Server } from 'node:http';
import type { PoolClient } from 'pg';
import request from 'supertest';
import { decideApproval, prepareApproval } from '../../src/modules/admin/approval.store';
import type { AdminPrincipal } from '../../src/modules/admin/domain';
import type { RelyingParty } from '../../src/modules/admin/webauthn';
import {
  createPartnerManagerPayload,
  insertPartnerManager,
  insertPartnerSeller,
  issuePartnerEnrollment,
  type PartnerPrincipal,
} from '../../src/modules/catalog/partner-user.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { registerPartnerCredential } from '../../src/workflows/partner-auth';

/**
 * Comptes partenaires de test créés par les flux réels (D63) : gérant né
 * d'une demande PARTNER_APPROVAL approuvée par une autre personne, vendeur
 * créé et enrôlé par ce gérant ; clés P-256 d'un authentificateur logiciel
 * conforme à la spécification WebAuthn. Aucun service simulé.
 */
export const PARTNER_RP_TEST: RelyingParty = { rpId: 'partenaires.molopay.test', origins: new Set(['https://partenaires.molopay.test']) };
export const PARTNER_ORIGIN = 'https://partenaires.molopay.test';

type Sql = Pick<PoolClient, 'query'>;
/** Exécute une action dans une transaction applicative (rôle app_rw). */
export type Transact = <T>(action: (client: Sql) => Promise<T>) => Promise<T>;
export type PartnerKey = { readonly privateKey: KeyObject; readonly spki: Buffer; readonly credentialId: Buffer };

export function partnerKey(): PartnerKey {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { privateKey: pair.privateKey, spki: pair.publicKey.export({ type: 'spki', format: 'der' }), credentialId: randomBytes(32) };
}

function authData(flags: number, signCount: number, credentialId?: Buffer): Buffer {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(signCount);
  const parts: Buffer[] = [createHash('sha256').update(PARTNER_RP_TEST.rpId).digest(), Buffer.from([flags]), counter];
  if (credentialId !== undefined) {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(credentialId.length);
    parts.push(Buffer.alloc(16), length, credentialId, Buffer.from([0xa0]));
  }
  return Buffer.concat(parts);
}

function clientData(type: string, challenge: Buffer): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge: challenge.toString('base64url'), origin: PARTNER_ORIGIN, crossOrigin: false }));
}

async function enroll(transact: Transact, userId: string, by: Parameters<typeof issuePartnerEnrollment>[1]['by']): Promise<PartnerKey> {
  const device = partnerKey();
  const enrollment = await transact((client) => issuePartnerEnrollment(client, { userId, by }));
  await transact((client) =>
    registerPartnerCredential(client, {
      rp: PARTNER_RP_TEST,
      challengeId: enrollment.challengeId,
      enrollmentToken: enrollment.enrollmentToken,
      clientDataJSON: clientData('webauthn.create', enrollment.challenge),
      authenticatorData: authData(0x45, 0, device.credentialId),
      credentialId: device.credentialId,
      publicKeySpki: device.spki,
    }),
  );
  return device;
}

/** Gérant (maker-checker) et vendeur d'un marchand validé, chacun avec sa clé enrôlée. */
export async function createPartnerStaff(
  transact: Transact,
  input: { readonly partnerId: string; readonly managerLogin: string; readonly sellerLogin: string },
): Promise<{ readonly manager: PartnerPrincipal; readonly seller: PartnerPrincipal; readonly managerKey: PartnerKey; readonly sellerKey: PartnerKey }> {
  const network: AdminPrincipal = { actorId: 'net-1', roles: ['PARTNER_NETWORK'], partnerIds: [input.partnerId] };
  const compliance: AdminPrincipal = { actorId: 'comp-1', roles: ['COMPLIANCE'] };
  const managerId = uuidv7();
  const requestId = uuidv7();
  const payload = createPartnerManagerPayload({ partnerId: input.partnerId, userId: managerId, login: input.managerLogin });
  const context = { partnerId: input.partnerId };
  await transact((client) => prepareApproval(client, { id: requestId, kind: 'PARTNER_APPROVAL', payload, reason: 'Gérant de test', principal: network, context }));
  await transact((client) => decideApproval(client, { requestId, principal: compliance, decision: 'APPROVED', context }));
  await transact((client) => insertPartnerManager(client, { id: managerId, partnerId: input.partnerId, login: input.managerLogin, approvalRequestId: requestId }));
  const manager: PartnerPrincipal = { userId: managerId, login: input.managerLogin, partnerId: input.partnerId, role: 'MANAGER' };
  const sellerId = uuidv7();
  await transact((client) => insertPartnerSeller(client, { id: sellerId, manager, login: input.sellerLogin }));
  const seller: PartnerPrincipal = { userId: sellerId, login: input.sellerLogin, partnerId: input.partnerId, role: 'SELLER' };
  const managerKey = await enroll(transact, managerId, { staffActorId: 'net-1' });
  const sellerKey = await enroll(transact, sellerId, { manager });
  return { manager, seller, managerKey, sellerKey };
}

/** Corps de connexion signé (défi obtenu par la route réelle du portail partenaire). */
export async function partnerLoginBody(server: Server, login: string, key: PartnerKey, signCount: number): Promise<Record<string, string>> {
  const challenge = await request(server)
    .post('/v1/partner/login-challenges')
    .set('Origin', PARTNER_ORIGIN)
    .set('Idempotency-Key', `partner-${uuidv7()}`)
    .send({ login });
  const { challengeId, challenge: encoded } = challenge.body as { challengeId: string; challenge: string };
  const clientDataJSON = clientData('webauthn.get', Buffer.from(encoded, 'base64url'));
  const authenticatorData = authData(0x05, signCount);
  const signature = sign('sha256', Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]), key.privateKey);
  return {
    challengeId,
    credentialId: key.credentialId.toString('base64url'),
    clientDataJSON: clientDataJSON.toString('base64url'),
    authenticatorData: authenticatorData.toString('base64url'),
    signature: signature.toString('base64url'),
  };
}

/** Cookie de session partenaire extrait d'une réponse de connexion. */
export function partnerCookie(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown;
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  const found = cookies.find((value) => value.startsWith('partner_session='));
  if (found === undefined) {
    throw new Error('cookie partner_session absent');
  }
  return found.split(';')[0] ?? '';
}

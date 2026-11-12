import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type { Server } from 'node:http';
import { Client } from 'pg';
import request from 'supertest';
import { decideApproval, prepareApproval } from '../../src/modules/admin/approval.store';
import type { AdminPrincipal, InternalRole } from '../../src/modules/admin/domain';
import { createStaffPayload, grantRolesPayload, insertRoleGrant, insertStaffAccount, issueEnrollment, registerStaffCredential } from '../../src/modules/admin/staff.store';
import type { RelyingParty } from '../../src/modules/admin/webauthn';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { randomUUID } from 'node:crypto';

/**
 * Personnel de test créé par les flux réels (ROLE_GRANT approuvé par deux
 * administrateurs, enrôlement WebAuthn) ; clé P-256 d'un authentificateur
 * logiciel conforme à la spécification. Aucun service simulé.
 */
export const STAFF_RP_TEST: RelyingParty = { rpId: 'backoffice.molopay.test', origins: new Set(['https://backoffice.molopay.test']) };
export const STAFF_ORIGIN = 'https://backoffice.molopay.test';
const ADMIN1: AdminPrincipal = { actorId: 'tech-1', roles: ['TECH_ADMIN'] };
const ADMIN2: AdminPrincipal = { actorId: 'tech-2', roles: ['TECH_ADMIN'] };

export type StaffKey = { readonly privateKey: KeyObject; readonly spki: Buffer; readonly credentialId: Buffer };

async function transact<T>(uri: string, action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_rw');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function approved(uri: string, payload: Record<string, unknown>): Promise<string> {
  const id = uuidv7();
  await transact(uri, (client) => prepareApproval(client, { id, kind: 'ROLE_GRANT', payload: payload as never, reason: 'Personnel de test', principal: ADMIN1 }));
  await transact(uri, (client) => decideApproval(client, { requestId: id, principal: ADMIN2, decision: 'APPROVED' }));
  return id;
}

function authData(flags: number, signCount: number, credentialId?: Buffer): Buffer {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(signCount);
  const parts: Buffer[] = [createHash('sha256').update(STAFF_RP_TEST.rpId).digest(), Buffer.from([flags]), counter];
  if (credentialId !== undefined) {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(credentialId.length);
    parts.push(Buffer.alloc(16), length, credentialId, Buffer.from([0xa0]));
  }
  return Buffer.concat(parts);
}

function clientData(type: string, challenge: Buffer): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge: challenge.toString('base64url'), origin: STAFF_ORIGIN, crossOrigin: false }));
}

/** Compte, rôles et clé enrôlée, par le circuit réel. */
export async function createStaffWithKey(
  uri: string,
  input: { readonly login: string; readonly roles: readonly InternalRole[]; readonly cityIds?: readonly string[]; readonly maxAmountXaf?: bigint | null },
): Promise<{ readonly staffId: string; readonly key: StaffKey }> {
  const staffId = uuidv7();
  const created = await approved(uri, createStaffPayload(staffId, input.login));
  await transact(uri, (client) => insertStaffAccount(client, { id: staffId, login: input.login, approvalRequestId: created }));
  const grant = { staffId, roles: input.roles, cityIds: input.cityIds ?? ['douala'], maxAmountXaf: input.maxAmountXaf ?? null };
  const granted = await approved(uri, grantRolesPayload(grant));
  await transact(uri, (client) => insertRoleGrant(client, { ...grant, approvalRequestId: granted }));
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const key: StaffKey = { privateKey: pair.privateKey, spki: pair.publicKey.export({ type: 'spki', format: 'der' }), credentialId: randomBytes(32) };
  const enrollment = await transact(uri, (client) => issueEnrollment(client, { staffId, actorId: 'tech-1' }));
  await transact(uri, (client) =>
    registerStaffCredential(client, {
      rp: STAFF_RP_TEST,
      challengeId: enrollment.challengeId,
      enrollmentToken: enrollment.enrollmentToken,
      clientDataJSON: clientData('webauthn.create', enrollment.challenge),
      authenticatorData: authData(0x45, 0, key.credentialId),
      credentialId: key.credentialId,
      publicKeySpki: key.spki,
    }),
  );
  return { staffId, key };
}

/** Connexion par les routes HTTP réelles ; renvoie la réponse (cookie dans set-cookie). */
export async function loginOverHttp(server: Server, login: string, key: StaffKey, signCount: number, sessionKey = `staff-${randomUUID()}`): Promise<request.Response> {
  const body = await loginBody(server, login, key, signCount);
  return request(server).post('/v1/staff/sessions').set('Origin', STAFF_ORIGIN).set('Idempotency-Key', sessionKey).send(body);
}

/** Corps de connexion signé (défi obtenu par la route réelle). */
export async function loginBody(server: Server, login: string, key: StaffKey, signCount: number): Promise<Record<string, string>> {
  const challenge = await request(server).post('/v1/staff/login-challenges').set('Origin', STAFF_ORIGIN).set('Idempotency-Key', `staff-${randomUUID()}`).send({ login });
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

/** Cookie de session du personnel extrait d'une réponse de connexion. */
export function staffCookie(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown;
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  const found = cookies.find((value) => value.startsWith('staff_session='));
  if (found === undefined) {
    throw new Error('cookie staff_session absent');
  }
  return found.split(';')[0] ?? '';
}

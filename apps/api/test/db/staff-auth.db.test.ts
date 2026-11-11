import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decideApproval, prepareApproval } from '../../src/modules/admin/approval.store';
import type { AdminPrincipal } from '../../src/modules/admin/domain';
import {
  createStaffPayload,
  grantRolesPayload,
  insertRoleGrant,
  insertStaffAccount,
  insertStaffDisable,
  issueEnrollment,
  issueLoginChallenge,
  loginStaff,
  registerStaffCredential,
  resolveStaffPrincipal,
  revokeStaffSession,
} from '../../src/modules/admin/staff.store';
import type { RelyingParty } from '../../src/modules/admin/webauthn';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * SEC-AUTH-004/005, SEC-AUTHZ-001/003 (D62, ADR-0007 proposé) : du compte
 * approuvé par deux administrateurs à la session WebAuthn, sur PostgreSQL
 * réel avec toutes les migrations. Authentificateur logiciel conforme à la
 * spécification WebAuthn (vraies clés P-256).
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const RP: RelyingParty = { rpId: 'backoffice.molopay.test', origins: new Set(['https://backoffice.molopay.test']) };
const ADMIN1: AdminPrincipal = { actorId: 'tech-1', roles: ['TECH_ADMIN'] };
const ADMIN2: AdminPrincipal = { actorId: 'tech-2', roles: ['TECH_ADMIN'] };

let container: TestDatabase;
let admin: Client;
let migrations: string[];

async function transact<T>(action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: container.getConnectionUri() });
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

async function failure(action: () => Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  try {
    await action();
  } catch (error: unknown) {
    if (error instanceof BusinessError) {
      return { code: error.code, message: error.message };
    }
    const pg = error as { code?: string; message?: string };
    return { code: pg.code, message: pg.message ?? '' };
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

/** Demande ROLE_GRANT préparée par ADMIN1, approuvée par ADMIN2. */
async function approved(payload: Record<string, unknown>): Promise<string> {
  const id = uuidv7();
  await transact((client) => prepareApproval(client, { id, kind: 'ROLE_GRANT', payload: payload as never, reason: 'Arrivée d’un agent', principal: ADMIN1 }));
  await transact((client) => decideApproval(client, { requestId: id, principal: ADMIN2, decision: 'APPROVED' }));
  return id;
}

async function staff(login: string, roles: AdminPrincipal['roles'] = ['FINANCE']): Promise<string> {
  const id = uuidv7();
  const created = await approved(createStaffPayload(id, login));
  await transact((client) => insertStaffAccount(client, { id, login, approvalRequestId: created }));
  const grant = { staffId: id, roles, cityIds: ['douala'], maxAmountXaf: 500_000n };
  const granted = await approved(grantRolesPayload(grant));
  await transact((client) => insertRoleGrant(client, { ...grant, approvalRequestId: granted }));
  return id;
}

type Key = { readonly privateKey: KeyObject; readonly spki: Buffer; readonly credentialId: Buffer };

function key(): Key {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { privateKey: pair.privateKey, spki: pair.publicKey.export({ type: 'spki', format: 'der' }), credentialId: randomBytes(32) };
}

function clientData(type: string, challenge: Buffer): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge: challenge.toString('base64url'), origin: 'https://backoffice.molopay.test', crossOrigin: false }));
}

function authData(flags: number, signCount: number, credentialId?: Buffer): Buffer {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(signCount);
  const parts: Buffer[] = [createHash('sha256').update(RP.rpId).digest(), Buffer.from([flags]), counter];
  if (credentialId !== undefined) {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(credentialId.length);
    parts.push(Buffer.alloc(16), length, credentialId, Buffer.from([0xa0]));
  }
  return Buffer.concat(parts);
}

async function enroll(staffId: string, device: Key): Promise<void> {
  const enrollment = await transact((client) => issueEnrollment(client, { staffId, actorId: 'tech-1' }));
  await transact((client) =>
    registerStaffCredential(client, {
      rp: RP,
      challengeId: enrollment.challengeId,
      enrollmentToken: enrollment.enrollmentToken,
      clientDataJSON: clientData('webauthn.create', enrollment.challenge),
      authenticatorData: authData(0x45, 0, device.credentialId),
      credentialId: device.credentialId,
      publicKeySpki: device.spki,
    }),
  );
}

async function login(loginName: string, device: Key, signCount: number): Promise<{ sessionToken: string; expiresAt: string }> {
  const { challengeId, challenge } = await transact((client) => issueLoginChallenge(client, loginName));
  const clientDataJSON = clientData('webauthn.get', challenge);
  const authenticatorData = authData(0x05, signCount);
  const signature = sign('sha256', Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]), device.privateKey);
  return transact((client) => loginStaff(client, { rp: RP, challengeId, credentialId: device.credentialId, clientDataJSON, authenticatorData, signature }));
}

beforeAll(async () => {
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
}, 120_000);

afterAll(async () => {
  await admin.end();
  await container.stop();
});

beforeEach(async () => {
  for (const schema of SCHEMAS) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrations) {
    await admin.query(sql);
  }
});

describe('SEC-AUTHZ-003 comptes et rôles du personnel en maker-checker', () => {
  it('compte et rôles créés depuis des demandes approuvées par une autre personne', async () => {
    const id = await staff('awa.finance');
    const rows = await admin.query('SELECT login FROM admin.staff_account WHERE id = $1', [id]);
    expect(rows.rows).toEqual([{ login: 'awa.finance' }]);
  });

  it('I-7 le préparateur ne peut pas approuver sa propre demande (domaine et base)', async () => {
    const id = uuidv7();
    await transact((client) => prepareApproval(client, { id, kind: 'ROLE_GRANT', payload: createStaffPayload(uuidv7(), 'x.agent'), reason: 'test', principal: ADMIN1 }));
    expect((await failure(() => transact((client) => decideApproval(client, { requestId: id, principal: ADMIN1, decision: 'APPROVED' })))).code).toBe('MAKER_CANNOT_APPROVE');
  });

  it('la base refuse un compte sans demande approuvée ou différent de la demande', async () => {
    const id = uuidv7();
    const pending = uuidv7();
    await transact((client) => prepareApproval(client, { id: pending, kind: 'ROLE_GRANT', payload: createStaffPayload(id, 'b.agent'), reason: 'test', principal: ADMIN1 }));
    expect((await failure(() => transact((client) => insertStaffAccount(client, { id, login: 'b.agent', approvalRequestId: pending })))).message).toMatch(/^ADMIN_INVALID_REQUEST/);
    const ok = await approved(createStaffPayload(id, 'b.agent'));
    expect((await failure(() => transact((client) => insertStaffAccount(client, { id, login: 'b.autre', approvalRequestId: ok })))).message).toMatch(/^ADMIN_INVALID_REQUEST/);
  });

  it('la base refuse des rôles différents de la demande approuvée (élévation de privilège)', async () => {
    const id = await staff('c.agent', ['SUPPORT_N1']);
    const grant = { staffId: id, roles: ['SUPPORT_N1'] as AdminPrincipal['roles'], cityIds: ['douala'], maxAmountXaf: null };
    const request = await approved(grantRolesPayload(grant));
    const result = await failure(() => transact((client) => insertRoleGrant(client, { ...grant, roles: ['TECH_ADMIN'], approvalRequestId: request })));
    expect(result.message).toMatch(/^ADMIN_INVALID_REQUEST/);
  });
});

describe('SEC-AUTH-004/005 enrôlement WebAuthn, connexion et session', () => {
  it('enrôlement avec le jeton remis, connexion : principal reconstruit (rôles, villes, plafond)', async () => {
    const id = await staff('awa.finance');
    const device = key();
    await enroll(id, device);
    const session = await login('awa.finance', device, 1);
    const principal = await transact((client) => resolveStaffPrincipal(client, session.sessionToken));
    expect(principal).toEqual({ actorId: 'awa.finance', roles: ['FINANCE'], cityIds: ['douala'], maxAmountXaf: 500_000n });
    expect(Date.parse(session.expiresAt) - Date.now()).toBeLessThanOrEqual(15 * 60_000);
  });

  it('refuse un enrôlement avec un mauvais jeton, puis un défi réutilisé', async () => {
    const id = await staff('d.agent');
    const device = key();
    const enrollment = await transact((client) => issueEnrollment(client, { staffId: id, actorId: 'tech-1' }));
    const attempt = (token: string): Promise<void> =>
      transact((client) =>
        registerStaffCredential(client, {
          rp: RP,
          challengeId: enrollment.challengeId,
          enrollmentToken: token,
          clientDataJSON: clientData('webauthn.create', enrollment.challenge),
          authenticatorData: authData(0x45, 0, device.credentialId),
          credentialId: device.credentialId,
          publicKeySpki: device.spki,
        }),
      );
    expect((await failure(() => attempt('jeton-devine'))).code).toBe('STAFF_AUTH_INVALID');
    await attempt(enrollment.enrollmentToken);
    expect((await failure(() => attempt(enrollment.enrollmentToken))).code).toBe('STAFF_AUTH_INVALID');
  });

  it('identifiant inconnu : défi indiscernable, connexion refusée sans révéler le compte', async () => {
    const device = key();
    expect((await failure(() => login('inconnu.agent', device, 1))).code).toBe('STAFF_AUTH_INVALID');
  });

  it('clé d’un autre agent, compteur non croissant (clone) : refusés', async () => {
    const a = await staff('e.agent');
    const b = await staff('f.agent');
    const keyA = key();
    const keyB = key();
    await enroll(a, keyA);
    await enroll(b, keyB);
    expect((await failure(() => login('e.agent', keyB, 1))).code).toBe('STAFF_AUTH_INVALID');
    await login('e.agent', keyA, 5);
    expect((await failure(() => login('e.agent', keyA, 5))).code).toBe('STAFF_AUTH_INVALID');
  });

  it('la base refuse un compteur non croissant même hors du store', async () => {
    const a = await staff('g.agent');
    const device = key();
    await enroll(a, device);
    await login('g.agent', device, 3);
    const { challengeId } = await transact((client) => issueLoginChallenge(client, 'g.agent'));
    await admin.query('INSERT INTO admin.staff_challenge_use (challenge_id, used_at) VALUES ($1, now())', [challengeId]);
    const result = await failure(() =>
      admin.query('INSERT INTO admin.staff_assertion (id, credential_id, sign_count, challenge_id, asserted_at) VALUES (gen_random_uuid(), $1, 2, $2, now())', [
        device.credentialId,
        challengeId,
      ]),
    );
    expect(result.message).toMatch(/^STAFF_AUTH_INVALID/);
  });

  it('session révoquée ou compte désactivé : plus de principal, plus de connexion', async () => {
    const id = await staff('h.agent');
    const device = key();
    await enroll(id, device);
    const first = await login('h.agent', device, 1);
    await transact((client) => revokeStaffSession(client, first.sessionToken));
    expect(await transact((client) => resolveStaffPrincipal(client, first.sessionToken))).toBeNull();
    const second = await login('h.agent', device, 2);
    await transact((client) => insertStaffDisable(client, { staffId: id, actorId: 'tech-1', reason: 'départ' }));
    expect(await transact((client) => resolveStaffPrincipal(client, second.sessionToken))).toBeNull();
    expect((await failure(() => login('h.agent', device, 3))).code).toBe('STAFF_AUTH_INVALID');
  });

  it('la base lie défis, clés, assertions et sessions au même compte et au bon usage', async () => {
    const a = await staff('j.agent');
    const b = await staff('k.agent');
    const keyA = key();
    await enroll(a, keyA);
    // Clé enregistrée avec un défi de connexion : refusé.
    const loginChallenge = await transact((client) => issueLoginChallenge(client, 'j.agent'));
    await admin.query('INSERT INTO admin.staff_challenge_use (challenge_id, used_at) VALUES ($1, now())', [loginChallenge.challengeId]);
    const wrongPurpose = await failure(() =>
      admin.query(
        `INSERT INTO admin.staff_credential (credential_id, staff_id, public_key_spki, algorithm, sign_count, challenge_id, registered_at)
         VALUES ($1, $2, $3, 'ES256', 0, $4, now())`,
        [randomBytes(32), a, key().spki, loginChallenge.challengeId],
      ),
    );
    expect(wrongPurpose.message).toMatch(/^STAFF_AUTH_INVALID/);
    // Assertion de la clé de A avec un défi de connexion de B : refusée.
    const keyB = key();
    await enroll(b, keyB);
    const otherChallenge = await transact((client) => issueLoginChallenge(client, 'k.agent'));
    await admin.query('INSERT INTO admin.staff_challenge_use (challenge_id, used_at) VALUES ($1, now())', [otherChallenge.challengeId]);
    const crossAccount = await failure(() =>
      admin.query('INSERT INTO admin.staff_assertion (id, credential_id, sign_count, challenge_id, asserted_at) VALUES (gen_random_uuid(), $1, 1, $2, now())', [
        keyA.credentialId,
        otherChallenge.challengeId,
      ]),
    );
    expect(crossAccount.message).toMatch(/^STAFF_AUTH_INVALID/);
    // Session de B adossée à une assertion de A : refusée.
    await login('j.agent', keyA, 1);
    const assertion = (await admin.query<{ id: string }>('SELECT id FROM admin.staff_assertion LIMIT 1')).rows[0]!.id;
    const borrowed = await failure(() =>
      admin.query(
        `INSERT INTO admin.staff_session (id, staff_id, token_hash, assertion_id, created_at, expires_at)
         VALUES (gen_random_uuid(), $1, $2, $3, now(), now())`,
        [b, randomBytes(32), assertion],
      ),
    );
    expect(borrowed.message).toMatch(/^STAFF_AUTH_INVALID/);
  });

  it('tables d’authentification en ajout seul', async () => {
    const id = await staff('i.agent');
    for (const sql of ['UPDATE admin.staff_account SET login = login', 'DELETE FROM admin.staff_role_grant', 'TRUNCATE admin.staff_session_revocation']) {
      expect((await failure(() => admin.query(sql))).message, sql).toMatch(/^ADMIN_APPEND_ONLY/);
    }
    expect(id).toBeDefined();
  });
});

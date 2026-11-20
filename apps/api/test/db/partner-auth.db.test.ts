import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decideApproval, prepareApproval } from '../../src/modules/admin/approval.store';
import type { AdminPrincipal } from '../../src/modules/admin/domain';
import type { RelyingParty } from '../../src/modules/admin/webauthn';
import {
  createPartnerManagerPayload,
  insertPartnerManager,
  insertPartnerSeller,
  insertPartnerUserDisable,
  issuePartnerEnrollment,
  issuePartnerLoginChallenge,
  resolvePartnerPrincipal,
  revokePartnerSession,
  type PartnerPrincipal,
} from '../../src/modules/catalog/partner-user.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { loginPartner, registerPartnerCredential } from '../../src/workflows/partner-auth';
import { validateBeneficiary, validateMerchant } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * D63 (lot 20, SEC-AUTH-006, F-PRT-003) : comptes partenaires (gérant en
 * maker-checker, vendeurs créés par le gérant), enrôlement WebAuthn, connexion
 * et session, sur PostgreSQL réel avec toutes les migrations. Authentificateur
 * logiciel conforme à la spécification WebAuthn (vraies clés P-256).
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['crm', 'kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const RP: RelyingParty = { rpId: 'partenaires.molopay.test', origins: new Set(['https://partenaires.molopay.test']) };
const ORIGIN = 'https://partenaires.molopay.test';
const NETWORK: AdminPrincipal = { actorId: 'net-1', roles: ['PARTNER_NETWORK'], partnerIds: ['merchant-1', 'merchant-2', 'landlord-1', 'inconnu-1'] };
const COMPLIANCE: AdminPrincipal = { actorId: 'comp-1', roles: ['COMPLIANCE'] };

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

/** Demande PARTNER_APPROVAL préparée par le réseau, approuvée par la conformité. */
async function approved(payload: Record<string, string>): Promise<string> {
  const id = uuidv7();
  const context = { partnerId: payload['partner_id'] ?? '' };
  await transact((client) => prepareApproval(client, { id, kind: 'PARTNER_APPROVAL', payload, reason: 'Gérant du marchand', principal: NETWORK, context }));
  await transact((client) => decideApproval(client, { requestId: id, principal: COMPLIANCE, decision: 'APPROVED', context }));
  return id;
}

async function manager(login: string, partnerId = 'merchant-1'): Promise<string> {
  const id = uuidv7();
  const request = await approved(createPartnerManagerPayload({ partnerId, userId: id, login }));
  await transact((client) => insertPartnerManager(client, { id, partnerId, login, approvalRequestId: request }));
  return id;
}

function principal(userId: string, login: string, role: PartnerPrincipal['role'], partnerId = 'merchant-1'): PartnerPrincipal {
  return { userId, login, partnerId, role };
}

type Key = { readonly privateKey: KeyObject; readonly spki: Buffer; readonly credentialId: Buffer };

function key(): Key {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { privateKey: pair.privateKey, spki: pair.publicKey.export({ type: 'spki', format: 'der' }), credentialId: randomBytes(32) };
}

function clientData(type: string, challenge: Buffer, origin = ORIGIN): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge: challenge.toString('base64url'), origin, crossOrigin: false }));
}

function authData(flags: number, signCount: number, credentialId?: Buffer, rpId = RP.rpId): Buffer {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(signCount);
  const parts: Buffer[] = [createHash('sha256').update(rpId).digest(), Buffer.from([flags]), counter];
  if (credentialId !== undefined) {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(credentialId.length);
    parts.push(Buffer.alloc(16), length, credentialId, Buffer.from([0xa0]));
  }
  return Buffer.concat(parts);
}

async function enroll(userId: string, device: Key, by: Parameters<typeof issuePartnerEnrollment>[1]['by'] = { staffActorId: 'net-1' }): Promise<void> {
  const enrollment = await transact((client) => issuePartnerEnrollment(client, { userId, by }));
  await transact((client) =>
    registerPartnerCredential(client, {
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

async function login(loginName: string, device: Key, signCount: number, rp: RelyingParty = RP): Promise<{ sessionToken: string; expiresAt: string }> {
  const { challengeId, challenge } = await transact((client) => issuePartnerLoginChallenge(client, loginName));
  const clientDataJSON = clientData('webauthn.get', challenge);
  const authenticatorData = authData(0x05, signCount);
  const signature = sign('sha256', Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]), device.privateKey);
  return transact((client) => loginPartner(client, { rp, challengeId, credentialId: device.credentialId, clientDataJSON, authenticatorData, signature }));
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
  await validateMerchant(admin, uuidv7(), 'merchant-1');
  await validateMerchant(admin, uuidv7(), 'merchant-2');
});

describe('SEC-AUTHZ-003 / F-PRT-003 comptes partenaires', () => {
  it('gérant créé depuis une demande PARTNER_APPROVAL approuvée par une autre personne', async () => {
    const id = await manager('awa.gerant');
    const rows = await admin.query('SELECT partner_id, login, role FROM catalog.partner_user WHERE id = $1', [id]);
    expect(rows.rows).toEqual([{ partner_id: 'merchant-1', login: 'awa.gerant', role: 'MANAGER' }]);
  });

  it('I-7 le préparateur ne peut pas approuver la création du gérant', async () => {
    const id = uuidv7();
    const payload = createPartnerManagerPayload({ partnerId: 'merchant-1', userId: uuidv7(), login: 'x.gerant' });
    const self: AdminPrincipal = { actorId: 'net-1', roles: ['PARTNER_NETWORK', 'COMPLIANCE'], partnerIds: ['merchant-1'] };
    await transact((client) => prepareApproval(client, { id, kind: 'PARTNER_APPROVAL', payload, reason: 'test', principal: self, context: { partnerId: 'merchant-1' } }));
    const result = await failure(() => transact((client) => decideApproval(client, { requestId: id, principal: self, decision: 'APPROVED', context: { partnerId: 'merchant-1' } })));
    expect(result.code).toBe('MAKER_CANNOT_APPROVE');
  });

  it('la base refuse un gérant sans demande approuvée, différent de la demande ou d’un autre partenaire', async () => {
    const id = uuidv7();
    const pending = uuidv7();
    const payload = createPartnerManagerPayload({ partnerId: 'merchant-1', userId: id, login: 'b.gerant' });
    await transact((client) => prepareApproval(client, { id: pending, kind: 'PARTNER_APPROVAL', payload, reason: 'test', principal: NETWORK, context: { partnerId: 'merchant-1' } }));
    expect((await failure(() => transact((client) => insertPartnerManager(client, { id, partnerId: 'merchant-1', login: 'b.gerant', approvalRequestId: pending })))).message).toMatch(/^ADMIN_INVALID_REQUEST/);
    const ok = await approved(payload);
    expect((await failure(() => transact((client) => insertPartnerManager(client, { id, partnerId: 'merchant-1', login: 'b.autre', approvalRequestId: ok })))).message).toMatch(/^ADMIN_INVALID_REQUEST: compte différent/);
    expect((await failure(() => transact((client) => insertPartnerManager(client, { id, partnerId: 'merchant-2', login: 'b.gerant', approvalRequestId: ok })))).message).toMatch(/^ADMIN_INVALID_REQUEST: compte différent/);
    await transact((client) => insertPartnerManager(client, { id, partnerId: 'merchant-1', login: 'b.gerant', approvalRequestId: ok }));
  });

  it('la base refuse une demande approuvée d’un autre type (ROLE_GRANT, domaine contourné)', async () => {
    const id = uuidv7();
    const request = uuidv7();
    const payload = createPartnerManagerPayload({ partnerId: 'merchant-1', userId: id, login: 'c.gerant' });
    await admin.query(
      `INSERT INTO admin.approval_request (id, kind, maker_id, payload, payload_hash, reason, prepared_at, expires_at)
       VALUES ($1, 'ROLE_GRANT', 'tech-1', $2::jsonb, $3, 'test', now(), now() + interval '1 day')`,
      [request, JSON.stringify(payload), randomBytes(32)],
    );
    await admin.query(`INSERT INTO admin.approval_decision (request_id, decision, decided_by, decided_at) VALUES ($1, 'APPROVED', 'tech-2', now())`, [request]);
    const result = await failure(() => transact((client) => insertPartnerManager(client, { id, partnerId: 'merchant-1', login: 'c.gerant', approvalRequestId: request })));
    expect(result.message).toMatch(/^ADMIN_INVALID_REQUEST: demande PARTNER_APPROVAL/);
  });

  it('comptes réservés à un marchand validé (bénéficiaire ou partenaire inconnu refusés)', async () => {
    await validateBeneficiary(admin, uuidv7(), 'landlord-1', 'LANDLORD');
    for (const partnerId of ['landlord-1', 'inconnu-1']) {
      const id = uuidv7();
      const request = await approved(createPartnerManagerPayload({ partnerId, userId: id, login: `g.${partnerId}` }));
      const result = await failure(() => transact((client) => insertPartnerManager(client, { id, partnerId, login: `g.${partnerId}`, approvalRequestId: request })));
      expect(result.message).toMatch(/^CATALOG_INVALID_REQUEST: comptes réservés à un marchand validé/);
    }
  });

  it('vendeur créé par un gérant actif du même partenaire uniquement (base garante)', async () => {
    const gerant = await manager('d.gerant');
    const autre = await manager('e.gerant', 'merchant-2');
    const seller = uuidv7();
    await transact((client) => insertPartnerSeller(client, { id: seller, manager: principal(gerant, 'd.gerant', 'MANAGER'), login: 'f.vendeur' }));
    // Le domaine refuse un vendeur créateur ; la base refuse un gérant d'un autre partenaire présenté comme celui-ci.
    expect((await failure(() => transact((client) => insertPartnerSeller(client, { id: uuidv7(), manager: principal(seller, 'f.vendeur', 'SELLER'), login: 'g.vendeur' })))).code).toBe('PARTNER_ROLE_DENIED');
    const forged = await failure(() =>
      transact((client) => insertPartnerSeller(client, { id: uuidv7(), manager: principal(autre, 'e.gerant', 'MANAGER', 'merchant-1'), login: 'h.vendeur' })),
    );
    expect(forged.message).toMatch(/^PARTNER_ROLE_DENIED: vendeur créé par un gérant actif/);
    const viaSeller = await failure(() =>
      transact((client) => client.query(`INSERT INTO catalog.partner_user (id, partner_id, login, role, created_by_user, created_at) VALUES ($1, 'merchant-1', 'i.vendeur', 'SELLER', $2, now())`, [uuidv7(), seller])),
    );
    expect(viaSeller.message).toMatch(/^PARTNER_ROLE_DENIED/);
    await transact((client) => insertPartnerUserDisable(client, { userId: gerant, by: { staffActorId: 'net-1' }, reason: 'départ' }));
    const disabled = await failure(() => transact((client) => insertPartnerSeller(client, { id: uuidv7(), manager: principal(gerant, 'd.gerant', 'MANAGER'), login: 'j.vendeur' })));
    expect(disabled.message).toMatch(/^PARTNER_ROLE_DENIED/);
  });

  it('un gérant ne désactive que ses vendeurs ; un gérant est désactivé par le personnel', async () => {
    const gerant = await manager('k.gerant');
    const autre = await manager('l.gerant', 'merchant-2');
    const seller = uuidv7();
    await transact((client) => insertPartnerSeller(client, { id: seller, manager: principal(gerant, 'k.gerant', 'MANAGER'), login: 'm.vendeur' }));
    const other = await failure(() => transact((client) => insertPartnerUserDisable(client, { userId: seller, by: { manager: principal(autre, 'l.gerant', 'MANAGER', 'merchant-2') }, reason: 'x' })));
    expect(other.message).toMatch(/^PARTNER_ROLE_DENIED: un gérant ne désactive que les vendeurs/);
    const second = await manager('n.gerant');
    const peer = await failure(() => transact((client) => insertPartnerUserDisable(client, { userId: second, by: { manager: principal(gerant, 'k.gerant', 'MANAGER') }, reason: 'x' })));
    expect(peer.message).toMatch(/^PARTNER_ROLE_DENIED/);
    await transact((client) => insertPartnerUserDisable(client, { userId: seller, by: { manager: principal(gerant, 'k.gerant', 'MANAGER') }, reason: 'fin de contrat' }));
    await transact((client) => insertPartnerUserDisable(client, { userId: second, by: { staffActorId: 'net-1' }, reason: 'départ' }));
    const rows = await admin.query('SELECT count(*)::int AS n FROM catalog.partner_user_disable');
    expect(rows.rows[0]).toEqual({ n: 2 });
  });
});

describe('SEC-AUTH-006 / SEC-AUTH-005 enrôlement WebAuthn, connexion et session', () => {
  it('gérant enrôlé par le personnel, vendeur par son gérant ; principal reconstruit avec partenaire et rôle', async () => {
    const gerant = await manager('awa.gerant');
    const seller = uuidv7();
    await transact((client) => insertPartnerSeller(client, { id: seller, manager: principal(gerant, 'awa.gerant', 'MANAGER'), login: 'paul.vendeur' }));
    const managerKey = key();
    const sellerKey = key();
    await enroll(gerant, managerKey);
    await enroll(seller, sellerKey, { manager: principal(gerant, 'awa.gerant', 'MANAGER') });
    const managerSession = await login('awa.gerant', managerKey, 1);
    const sellerSession = await login('paul.vendeur', sellerKey, 1);
    expect(await transact((client) => resolvePartnerPrincipal(client, managerSession.sessionToken))).toEqual({ userId: gerant, login: 'awa.gerant', partnerId: 'merchant-1', role: 'MANAGER' });
    expect(await transact((client) => resolvePartnerPrincipal(client, sellerSession.sessionToken))).toEqual({ userId: seller, login: 'paul.vendeur', partnerId: 'merchant-1', role: 'SELLER' });
    expect(Date.parse(sellerSession.expiresAt) - Date.now()).toBeLessThanOrEqual(15 * 60_000);
  });

  it('enrôlement : gérant uniquement par le personnel, vendeur uniquement par un gérant du même partenaire', async () => {
    const gerant = await manager('o.gerant');
    const autre = await manager('p.gerant', 'merchant-2');
    const seller = uuidv7();
    await transact((client) => insertPartnerSeller(client, { id: seller, manager: principal(gerant, 'o.gerant', 'MANAGER'), login: 'q.vendeur' }));
    const self = await failure(() => transact((client) => issuePartnerEnrollment(client, { userId: gerant, by: { manager: principal(gerant, 'o.gerant', 'MANAGER') } })));
    expect(self.message).toMatch(/^PARTNER_ROLE_DENIED: l'enrôlement d'un gérant/);
    const foreign = await failure(() => transact((client) => issuePartnerEnrollment(client, { userId: seller, by: { manager: principal(autre, 'p.gerant', 'MANAGER', 'merchant-2') } })));
    expect(foreign.message).toMatch(/^PARTNER_ROLE_DENIED: l'enrôlement d'un vendeur/);
    const byStaff = await failure(() => transact((client) => issuePartnerEnrollment(client, { userId: seller, by: { staffActorId: 'net-1' } })));
    expect(byStaff.message).toMatch(/^PARTNER_ROLE_DENIED: l'enrôlement d'un vendeur/);
  });

  it('refuse un mauvais jeton d’enrôlement, puis un défi réutilisé', async () => {
    const gerant = await manager('r.gerant');
    const device = key();
    const enrollment = await transact((client) => issuePartnerEnrollment(client, { userId: gerant, by: { staffActorId: 'net-1' } }));
    const register = (token: string): Promise<void> =>
      transact((client) =>
        registerPartnerCredential(client, {
          rp: RP,
          challengeId: enrollment.challengeId,
          enrollmentToken: token,
          clientDataJSON: clientData('webauthn.create', enrollment.challenge),
          authenticatorData: authData(0x45, 0, device.credentialId),
          credentialId: device.credentialId,
          publicKeySpki: device.spki,
        }),
      );
    expect((await failure(() => register('mauvais-jeton'))).code).toBe('PARTNER_AUTH_INVALID');
    await register(enrollment.enrollmentToken);
    expect((await failure(() => register(enrollment.enrollmentToken))).code).toBe('PARTNER_AUTH_INVALID');
  });

  it('une preuve destinée au back-office (autre RP ID) est refusée avec le code partenaire', async () => {
    const gerant = await manager('s.gerant');
    const device = key();
    await enroll(gerant, device);
    const backoffice: RelyingParty = { rpId: 'backoffice.molopay.test', origins: new Set(['https://backoffice.molopay.test']) };
    expect((await failure(() => login('s.gerant', device, 1, backoffice))).code).toBe('PARTNER_AUTH_INVALID');
  });

  it('identifiant inconnu : défi indiscernable, jamais enregistré, connexion refusée', async () => {
    const knownId = await manager('connu.gerant');
    const known = await transact((client) => issuePartnerLoginChallenge(client, 'connu.gerant'));
    const challenge = await transact((client) => issuePartnerLoginChallenge(client, 'inconnu.vendeur'));
    const again = await transact((client) => issuePartnerLoginChallenge(client, 'inconnu.vendeur'));
    // Même forme qu'un défi d'identifiant connu (mêmes champs, mêmes tailles), aléatoire à chaque appel.
    expect(Object.keys(challenge).sort()).toEqual(Object.keys(known).sort());
    expect(challenge.challenge.length).toBe(known.challenge.length);
    expect(challenge.challengeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(known.challengeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(challenge.challenge.equals(again.challenge)).toBe(false);
    expect(challenge.challengeId).not.toBe(again.challengeId);
    // Seul le défi de l'identifiant connu est enregistré ; rien pour l'inconnu.
    const rows = await admin.query('SELECT user_id FROM catalog.partner_challenge');
    expect(rows.rows).toEqual([{ user_id: knownId }]);
    expect((await failure(() => login('inconnu.vendeur', key(), 1))).code).toBe('PARTNER_AUTH_INVALID');
  });

  it('clé d’un autre compte refusée ; compteur non croissant refusé (clé clonée)', async () => {
    const gerant = await manager('t.gerant');
    const autre = await manager('u.gerant');
    const device = key();
    const other = key();
    await enroll(gerant, device);
    await enroll(autre, other);
    expect((await failure(() => login('t.gerant', other, 1))).code).toBe('PARTNER_AUTH_INVALID');
    await login('t.gerant', device, 5);
    expect((await failure(() => login('t.gerant', device, 5))).code).toBe('PARTNER_AUTH_INVALID');
  });

  it('la base refuse un compteur non croissant même si le flux est contourné', async () => {
    const gerant = await manager('v.gerant');
    const device = key();
    await enroll(gerant, device);
    await login('v.gerant', device, 7);
    const { challengeId } = await transact((client) => issuePartnerLoginChallenge(client, 'v.gerant'));
    const result = await failure(() =>
      transact(async (client) => {
        await client.query('INSERT INTO catalog.partner_challenge_use (challenge_id, used_at) VALUES ($1, now())', [challengeId]);
        await client.query('INSERT INTO catalog.partner_assertion (id, credential_id, sign_count, challenge_id, asserted_at) VALUES ($1, $2, 7, $3, now())', [uuidv7(), device.credentialId, challengeId]);
      }),
    );
    expect(result.message).toMatch(/^PARTNER_AUTH_INVALID: compteur non croissant/);
  });

  it('la base refuse une clé enregistrée sur le défi d’un autre compte ou un défi de connexion', async () => {
    const gerant = await manager('w.gerant');
    const autre = await manager('x.gerant');
    const enrollment = await transact((client) => issuePartnerEnrollment(client, { userId: gerant, by: { staffActorId: 'net-1' } }));
    const device = key();
    const insert = (userId: string, challengeId: string): Promise<unknown> =>
      transact(async (client) => {
        await client.query('INSERT INTO catalog.partner_challenge_use (challenge_id, used_at) VALUES ($1, now())', [challengeId]);
        await client.query(
          `INSERT INTO catalog.partner_credential (credential_id, user_id, public_key_spki, algorithm, sign_count, challenge_id, registered_at)
           VALUES ($1, $2, $3, 'ES256', 0, $4, now())`,
          [device.credentialId, userId, device.spki, challengeId],
        );
      });
    expect((await failure(() => insert(autre, enrollment.challengeId))).message).toMatch(/^PARTNER_AUTH_INVALID: défi d'enrôlement d'un autre compte/);
    const loginChallenge = await transact((client) => issuePartnerLoginChallenge(client, 'w.gerant'));
    expect((await failure(() => insert(gerant, loginChallenge.challengeId))).message).toMatch(/^PARTNER_AUTH_INVALID: défi d'enrôlement d'un autre compte ou d'un autre usage/);
  });

  it('la base refuse une session sans assertion du compte ; une assertion sur le défi d’un autre compte', async () => {
    const gerant = await manager('y.gerant');
    const autre = await manager('z.gerant');
    const device = key();
    await enroll(gerant, device);
    await login('y.gerant', device, 1);
    const assertion = (await admin.query<{ id: string }>('SELECT id FROM catalog.partner_assertion')).rows[0]?.id;
    const session = await failure(() =>
      transact((client) => client.query(`INSERT INTO catalog.partner_session (id, user_id, token_hash, assertion_id, created_at, expires_at) VALUES ($1, $2, $3, $4, now(), now())`, [uuidv7(), autre, randomBytes(32), assertion])),
    );
    expect(session.message).toMatch(/^PARTNER_AUTH_INVALID: session sans assertion du compte/);
    const foreign = await transact((client) => issuePartnerLoginChallenge(client, 'z.gerant'));
    const result = await failure(() =>
      transact(async (client) => {
        await client.query('INSERT INTO catalog.partner_challenge_use (challenge_id, used_at) VALUES ($1, now())', [foreign.challengeId]);
        await client.query('INSERT INTO catalog.partner_assertion (id, credential_id, sign_count, challenge_id, asserted_at) VALUES ($1, $2, 9, $3, now())', [uuidv7(), device.credentialId, foreign.challengeId]);
      }),
    );
    expect(result.message).toMatch(/^PARTNER_AUTH_INVALID: défi de connexion d'un autre compte/);
  });

  it('révocation et désactivation rendent la session inutilisable ; compte désactivé sans nouveau défi ni clé', async () => {
    const gerant = await manager('ab.gerant');
    const seller = uuidv7();
    await transact((client) => insertPartnerSeller(client, { id: seller, manager: principal(gerant, 'ab.gerant', 'MANAGER'), login: 'ac.vendeur' }));
    const device = key();
    await enroll(seller, device, { manager: principal(gerant, 'ab.gerant', 'MANAGER') });
    const first = await login('ac.vendeur', device, 1);
    await transact((client) => revokePartnerSession(client, first.sessionToken));
    expect(await transact((client) => resolvePartnerPrincipal(client, first.sessionToken))).toBeNull();
    const second = await login('ac.vendeur', device, 2);
    const pending = await transact((client) => issuePartnerEnrollment(client, { userId: seller, by: { manager: principal(gerant, 'ab.gerant', 'MANAGER') } }));
    await transact((client) => insertPartnerUserDisable(client, { userId: seller, by: { manager: principal(gerant, 'ab.gerant', 'MANAGER') }, reason: 'fin de contrat' }));
    expect(await transact((client) => resolvePartnerPrincipal(client, second.sessionToken))).toBeNull();
    expect((await failure(() => login('ac.vendeur', device, 3))).code).toBe('PARTNER_AUTH_INVALID');
    const direct = await failure(() =>
      transact((client) => client.query(`INSERT INTO catalog.partner_challenge (id, user_id, purpose, challenge, issued_at, expires_at) VALUES ($1, $2, 'LOGIN', $3, now(), now())`, [uuidv7(), seller, randomBytes(32)])),
    );
    expect(direct.message).toMatch(/^PARTNER_AUTH_INVALID: compte désactivé/);
    const other = key();
    const late = await failure(() =>
      transact((client) =>
        registerPartnerCredential(client, {
          rp: RP,
          challengeId: pending.challengeId,
          enrollmentToken: pending.enrollmentToken,
          clientDataJSON: clientData('webauthn.create', pending.challenge),
          authenticatorData: authData(0x45, 0, other.credentialId),
          credentialId: other.credentialId,
          publicKeySpki: other.spki,
        }),
      ),
    );
    expect(late.message).toMatch(/^PARTNER_AUTH_INVALID: compte désactivé/);
  });

  it('compte désactivé entre le défi et la réponse : la base refuse l’assertion', async () => {
    const gerant = await manager('ae.gerant');
    const device = key();
    await enroll(gerant, device);
    const { challengeId, challenge } = await transact((client) => issuePartnerLoginChallenge(client, 'ae.gerant'));
    await transact((client) => insertPartnerUserDisable(client, { userId: gerant, by: { staffActorId: 'net-1' }, reason: 'départ' }));
    const clientDataJSON = clientData('webauthn.get', challenge);
    const authenticatorData = authData(0x05, 1);
    const signature = sign('sha256', Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]), device.privateKey);
    const result = await failure(() => transact((client) => loginPartner(client, { rp: RP, challengeId, credentialId: device.credentialId, clientDataJSON, authenticatorData, signature })));
    expect(result.message).toMatch(/^PARTNER_AUTH_INVALID: compte désactivé/);
  });

  it('I-2 tables en ajout seul : droits retirés à l’application, déclencheur pour tout autre rôle', async () => {
    const gerant = await manager('ad.gerant');
    for (const sql of ['UPDATE catalog.partner_user SET login = $2 WHERE id = $1', 'DELETE FROM catalog.partner_user WHERE id = $1 AND $2::text IS NOT NULL']) {
      expect((await failure(() => transact((client) => client.query(sql, [gerant, 'autre.login'])))).message).toMatch(/^permission denied/);
      expect((await failure(() => admin.query(sql, [gerant, 'autre.login']))).message).toMatch(/^CATALOG_APPEND_ONLY/);
    }
  });
});

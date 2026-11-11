import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { INTERNAL_ROLES, type AdminPrincipal, type InternalRole } from './domain';
import { verifyAssertion, verifyRegistration, type RelyingParty } from './webauthn';

type SqlClient = Pick<PoolClient, 'query'>;

const LOGIN_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/;

function refuse(): never {
  throw new BusinessError('STAFF_AUTH_INVALID', 'Authentification refusée');
}

function sha256(data: Buffer | string): Buffer {
  return createHash('sha256').update(data).digest();
}

/** Charge exacte attendue par la base pour créer un compte (ROLE_GRANT). */
export function createStaffPayload(staffId: string, login: string): Record<string, string> {
  return { operation: 'CREATE_STAFF', staff_id: staffId, login };
}

/** Charge exacte attendue par la base pour attribuer des rôles (ROLE_GRANT). */
export function grantRolesPayload(input: {
  readonly staffId: string;
  readonly roles: readonly InternalRole[];
  readonly cityIds: readonly string[];
  readonly maxAmountXaf: bigint | null;
}): Record<string, string | string[] | null> {
  return {
    operation: 'GRANT_ROLES',
    staff_id: input.staffId,
    roles: [...input.roles],
    city_ids: [...input.cityIds],
    max_amount_xaf: input.maxAmountXaf === null ? null : input.maxAmountXaf.toString(),
  };
}

export async function insertStaffAccount(client: SqlClient, input: { readonly id: string; readonly login: string; readonly approvalRequestId: string }): Promise<void> {
  if (!LOGIN_PATTERN.test(input.login)) {
    throw new BusinessError('ADMIN_INVALID_REQUEST', 'identifiant de connexion invalide');
  }
  await client.query('INSERT INTO admin.staff_account (id, login, approval_request_id, created_at) VALUES ($1, $2, $3, now())', [
    input.id,
    input.login,
    input.approvalRequestId,
  ]);
}

export async function insertRoleGrant(
  client: SqlClient,
  input: { readonly staffId: string; readonly roles: readonly InternalRole[]; readonly cityIds: readonly string[]; readonly maxAmountXaf: bigint | null; readonly approvalRequestId: string },
): Promise<void> {
  if (input.roles.length === 0 || !input.roles.every((role) => (INTERNAL_ROLES as readonly string[]).includes(role))) {
    throw new BusinessError('ADMIN_INVALID_REQUEST', 'rôles invalides');
  }
  await client.query(
    `INSERT INTO admin.staff_role_grant (id, staff_id, roles, city_ids, max_amount_xaf, approval_request_id, granted_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [randomUUID(), input.staffId, input.roles, input.cityIds, input.maxAmountXaf?.toString() ?? null, input.approvalRequestId],
  );
}

/** Restrictif : une seule personne, motif obligatoire ; toutes les sessions deviennent inutilisables. */
export async function insertStaffDisable(client: SqlClient, input: { readonly staffId: string; readonly actorId: string; readonly reason: string }): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > 1000) {
    throw new BusinessError('ADMIN_INVALID_REQUEST', 'motif obligatoire');
  }
  await client.query('INSERT INTO admin.staff_disable (staff_id, disabled_by, reason, disabled_at) VALUES ($1, $2, $3, now())', [
    input.staffId,
    input.actorId,
    reason,
  ]);
}

/** Enrôlement : défi REGISTER et jeton à remettre hors bande (seule son empreinte est conservée). */
export async function issueEnrollment(
  client: SqlClient,
  input: { readonly staffId: string; readonly actorId: string },
): Promise<{ readonly challengeId: string; readonly challenge: Buffer; readonly enrollmentToken: string }> {
  const challengeId = randomUUID();
  const challenge = randomBytes(32);
  const enrollmentToken = randomBytes(32).toString('base64url');
  await client.query(
    `INSERT INTO admin.staff_challenge (id, staff_id, purpose, challenge, enrollment_token_hash, issued_by, issued_at, expires_at)
     VALUES ($1, $2, 'REGISTER', $3, $4, $5, now(), now())`,
    [challengeId, input.staffId, challenge, sha256(enrollmentToken), input.actorId],
  );
  return Object.freeze({ challengeId, challenge, enrollmentToken });
}

type ChallengeRow = { staff_id: string; purpose: 'REGISTER' | 'LOGIN'; challenge: Buffer; enrollment_token_hash: Buffer | null; live: boolean };

async function liveChallenge(client: SqlClient, challengeId: string, purpose: 'REGISTER' | 'LOGIN'): Promise<ChallengeRow> {
  const row = (await client.query<ChallengeRow>(
    `SELECT c.staff_id, c.purpose, c.challenge, c.enrollment_token_hash,
            c.expires_at > clock_timestamp() AND NOT EXISTS (SELECT 1 FROM admin.staff_challenge_use u WHERE u.challenge_id = c.id) AS live
       FROM admin.staff_challenge c WHERE c.id = $1`,
    [challengeId],
  )).rows[0];
  if (row === undefined || row.purpose !== purpose || !row.live) {
    refuse();
  }
  return row;
}

/** Enregistre la clé WebAuthn du compte après vérification complète (jeton, défi, preuve). */
export async function registerStaffCredential(
  client: SqlClient,
  input: {
    readonly rp: RelyingParty;
    readonly challengeId: string;
    readonly enrollmentToken: string;
    readonly clientDataJSON: Buffer;
    readonly authenticatorData: Buffer;
    readonly credentialId: Buffer;
    readonly publicKeySpki: Buffer;
  },
): Promise<void> {
  const challenge = await liveChallenge(client, input.challengeId, 'REGISTER');
  const presented = sha256(input.enrollmentToken);
  if (challenge.enrollment_token_hash === null || !timingSafeEqual(presented, challenge.enrollment_token_hash)) {
    refuse();
  }
  const registered = verifyRegistration({ ...input, expectedChallenge: challenge.challenge });
  await client.query('INSERT INTO admin.staff_challenge_use (challenge_id, used_at) VALUES ($1, now())', [input.challengeId]);
  await client.query(
    `INSERT INTO admin.staff_credential (credential_id, staff_id, public_key_spki, algorithm, sign_count, challenge_id, registered_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [registered.credentialId, challenge.staff_id, registered.publicKeySpki, registered.algorithm, registered.signCount, input.challengeId],
  );
}

/**
 * Défi de connexion. Un identifiant inconnu ou désactivé reçoit un défi
 * indiscernable, jamais enregistré : la connexion échouera sans révéler
 * l'existence du compte.
 */
export async function issueLoginChallenge(client: SqlClient, login: string): Promise<{ readonly challengeId: string; readonly challenge: Buffer }> {
  const challengeId = randomUUID();
  const challenge = randomBytes(32);
  const staff = (await client.query<{ id: string }>(
    `SELECT a.id FROM admin.staff_account a
      WHERE a.login = $1 AND NOT EXISTS (SELECT 1 FROM admin.staff_disable x WHERE x.staff_id = a.id)`,
    [login],
  )).rows[0];
  if (staff !== undefined) {
    await client.query(
      `INSERT INTO admin.staff_challenge (id, staff_id, purpose, challenge, enrollment_token_hash, issued_by, issued_at, expires_at)
       VALUES ($1, $2, 'LOGIN', $3, NULL, 'self', now(), now())`,
      [challengeId, staff.id, challenge],
    );
  }
  return Object.freeze({ challengeId, challenge });
}

/** Connexion : assertion vérifiée, défi consommé, compteur enregistré, session de 15 min ; renvoie le jeton (une seule fois). */
export async function loginStaff(
  client: SqlClient,
  input: {
    readonly rp: RelyingParty;
    readonly challengeId: string;
    readonly credentialId: Buffer;
    readonly clientDataJSON: Buffer;
    readonly authenticatorData: Buffer;
    readonly signature: Buffer;
  },
): Promise<{ readonly sessionToken: string; readonly expiresAt: string }> {
  const challenge = await liveChallenge(client, input.challengeId, 'LOGIN');
  const credential = (await client.query<{ public_key_spki: Buffer; sign_count: string }>(
    `SELECT c.public_key_spki,
            GREATEST(c.sign_count, COALESCE((SELECT max(a.sign_count) FROM admin.staff_assertion a WHERE a.credential_id = c.credential_id), 0))::text AS sign_count
       FROM admin.staff_credential c WHERE c.credential_id = $1 AND c.staff_id = $2`,
    [input.credentialId, challenge.staff_id],
  )).rows[0];
  if (credential === undefined) {
    refuse();
  }
  const verified = verifyAssertion({
    rp: input.rp,
    expectedChallenge: challenge.challenge,
    credential: { publicKeySpki: credential.public_key_spki, signCount: Number(credential.sign_count) },
    clientDataJSON: input.clientDataJSON,
    authenticatorData: input.authenticatorData,
    signature: input.signature,
  });
  const assertionId = randomUUID();
  const sessionId = randomUUID();
  const sessionToken = randomBytes(32).toString('base64url');
  await client.query('INSERT INTO admin.staff_challenge_use (challenge_id, used_at) VALUES ($1, now())', [input.challengeId]);
  await client.query(
    'INSERT INTO admin.staff_assertion (id, credential_id, sign_count, challenge_id, asserted_at) VALUES ($1, $2, $3, $4, now())',
    [assertionId, input.credentialId, verified.signCount, input.challengeId],
  );
  const session = await client.query<{ expires_at: Date }>(
    `INSERT INTO admin.staff_session (id, staff_id, token_hash, assertion_id, created_at, expires_at)
     VALUES ($1, $2, $3, $4, now(), now()) RETURNING expires_at`,
    [sessionId, challenge.staff_id, sha256(sessionToken), assertionId],
  );
  return Object.freeze({ sessionToken, expiresAt: (session.rows[0]?.expires_at ?? new Date(0)).toISOString() });
}

/**
 * SEC-AUTHZ-001 : principal reconstruit côté serveur depuis la session
 * (non expirée, non révoquée, compte actif) et la dernière attribution de
 * rôles ; null sinon. L'identifiant d'acteur est l'identifiant de connexion.
 */
export async function resolveStaffPrincipal(client: SqlClient, sessionToken: string): Promise<AdminPrincipal | null> {
  const row = (await client.query<{ login: string; roles: InternalRole[]; city_ids: string[]; max_amount_xaf: string | null }>(
    `SELECT a.login, g.roles, g.city_ids, g.max_amount_xaf::text
       FROM admin.staff_session s
       JOIN admin.staff_account a ON a.id = s.staff_id
       JOIN LATERAL (SELECT * FROM admin.staff_role_grant r WHERE r.staff_id = a.id ORDER BY r.granted_at DESC, r.id DESC LIMIT 1) g ON true
      WHERE s.token_hash = $1
        AND s.expires_at > clock_timestamp()
        AND NOT EXISTS (SELECT 1 FROM admin.staff_session_revocation v WHERE v.session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM admin.staff_disable x WHERE x.staff_id = a.id)`,
    [sha256(sessionToken)],
  )).rows[0];
  if (row === undefined) {
    return null;
  }
  return Object.freeze({
    actorId: row.login,
    roles: Object.freeze([...row.roles]),
    cityIds: Object.freeze([...row.city_ids]),
    ...(row.max_amount_xaf === null ? {} : { maxAmountXaf: BigInt(row.max_amount_xaf) }),
  });
}

export async function revokeStaffSession(client: SqlClient, sessionToken: string): Promise<void> {
  await client.query(
    `INSERT INTO admin.staff_session_revocation (session_id, revoked_at)
     SELECT s.id, now() FROM admin.staff_session s WHERE s.token_hash = $1 ON CONFLICT DO NOTHING`,
    [sha256(sessionToken)],
  );
}

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * D63 (lot 20, SEC-AUTH-006, F-PRT-003) : comptes nominatifs des partenaires,
 * défis, clés et sessions en base (migration 0057, base garante). Aucune
 * vérification cryptographique ici : la preuve WebAuthn est vérifiée par le
 * flux (`workflows/partner-auth.ts`) avant tout enregistrement.
 */
export type PartnerRole = 'MANAGER' | 'SELLER';

/** Principal partenaire reconstruit côté serveur depuis la session. */
export type PartnerPrincipal = {
  readonly userId: string;
  readonly login: string;
  readonly partnerId: string;
  readonly role: PartnerRole;
};

const LOGIN_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/;

export function refusePartnerAuth(): never {
  throw new BusinessError('PARTNER_AUTH_INVALID', 'Authentification refusée');
}

export function sha256(data: Buffer | string): Buffer {
  return createHash('sha256').update(data).digest();
}

function assertLogin(login: string): void {
  if (!LOGIN_PATTERN.test(login)) {
    throw new BusinessError('CATALOG_INVALID_REQUEST', 'identifiant de connexion invalide');
  }
}

/** Charge exacte attendue par la base pour créer un gérant (PARTNER_APPROVAL). */
export function createPartnerManagerPayload(input: { readonly partnerId: string; readonly userId: string; readonly login: string }): Record<string, string> {
  return { operation: 'CREATE_PARTNER_MANAGER', partner_id: input.partnerId, user_id: input.userId, login: input.login };
}

export async function insertPartnerManager(
  client: SqlClient,
  input: { readonly id: string; readonly partnerId: string; readonly login: string; readonly approvalRequestId: string },
): Promise<void> {
  assertLogin(input.login);
  await client.query(
    `INSERT INTO catalog.partner_user (id, partner_id, login, role, approval_request_id, created_by_user, created_at)
     VALUES ($1, $2, $3, 'MANAGER', $4, NULL, now())`,
    [input.id, input.partnerId, input.login, input.approvalRequestId],
  );
}

/** F-PRT-003 : un gérant crée un vendeur de son propre partenaire (la base le vérifie). */
export async function insertPartnerSeller(
  client: SqlClient,
  input: { readonly id: string; readonly manager: PartnerPrincipal; readonly login: string },
): Promise<void> {
  assertLogin(input.login);
  if (input.manager.role !== 'MANAGER') {
    throw new BusinessError('PARTNER_ROLE_DENIED', 'réservé au gérant');
  }
  await client.query(
    `INSERT INTO catalog.partner_user (id, partner_id, login, role, approval_request_id, created_by_user, created_at)
     VALUES ($1, $2, $3, 'SELLER', NULL, $4, now())`,
    [input.id, input.manager.partnerId, input.login, input.manager.userId],
  );
}

/** Désactivation motivée : par un gérant (ses vendeurs) ou par le personnel interne. */
export async function insertPartnerUserDisable(
  client: SqlClient,
  input: { readonly userId: string; readonly by: { readonly manager: PartnerPrincipal } | { readonly staffActorId: string }; readonly reason: string },
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > 1000) {
    throw new BusinessError('CATALOG_INVALID_REQUEST', 'motif obligatoire');
  }
  const byUser = 'manager' in input.by ? input.by.manager.userId : null;
  const byStaff = 'staffActorId' in input.by ? input.by.staffActorId : null;
  await client.query(
    `INSERT INTO catalog.partner_user_disable (user_id, disabled_by_user, disabled_by_staff, reason, disabled_at)
     VALUES ($1, $2, $3, $4, now())`,
    [input.userId, byUser, byStaff, reason],
  );
}

/** Enrôlement : défi REGISTER et jeton à remettre hors bande (seule son empreinte est conservée). */
export async function issuePartnerEnrollment(
  client: SqlClient,
  input: { readonly userId: string; readonly by: { readonly manager: PartnerPrincipal } | { readonly staffActorId: string } },
): Promise<{ readonly challengeId: string; readonly challenge: Buffer; readonly enrollmentToken: string }> {
  const challengeId = randomUUID();
  const challenge = randomBytes(32);
  const enrollmentToken = randomBytes(32).toString('base64url');
  await client.query(
    `INSERT INTO catalog.partner_challenge
       (id, user_id, purpose, challenge, enrollment_token_hash, issued_by_user, issued_by_staff, issued_at, expires_at)
     VALUES ($1, $2, 'REGISTER', $3, $4, $5, $6, now(), now())`,
    [
      challengeId,
      input.userId,
      challenge,
      sha256(enrollmentToken),
      'manager' in input.by ? input.by.manager.userId : null,
      'staffActorId' in input.by ? input.by.staffActorId : null,
    ],
  );
  return Object.freeze({ challengeId, challenge, enrollmentToken });
}

export type PartnerChallenge = {
  readonly userId: string;
  readonly challenge: Buffer;
  readonly enrollmentTokenHash: Buffer | null;
};

/** Défi encore valable (non expiré, non consommé) de l'usage attendu ; refus générique sinon. */
export async function getLivePartnerChallenge(client: SqlClient, challengeId: string, purpose: 'REGISTER' | 'LOGIN'): Promise<PartnerChallenge> {
  const row = (await client.query<{ user_id: string; purpose: string; challenge: Buffer; enrollment_token_hash: Buffer | null; live: boolean }>(
    `SELECT c.user_id, c.purpose, c.challenge, c.enrollment_token_hash,
            c.expires_at > clock_timestamp() AND NOT EXISTS (SELECT 1 FROM catalog.partner_challenge_use u WHERE u.challenge_id = c.id) AS live
       FROM catalog.partner_challenge c WHERE c.id = $1`,
    [challengeId],
  )).rows[0];
  if (row === undefined || row.purpose !== purpose || !row.live) {
    refusePartnerAuth();
  }
  return { userId: row.user_id, challenge: row.challenge, enrollmentTokenHash: row.enrollment_token_hash };
}

/** Clé vérifiée par le flux : défi consommé et clé enregistrée dans la même transaction. */
export async function recordPartnerCredential(
  client: SqlClient,
  input: { readonly challengeId: string; readonly userId: string; readonly credentialId: Buffer; readonly publicKeySpki: Buffer; readonly algorithm: 'ES256' | 'EdDSA'; readonly signCount: number },
): Promise<void> {
  await client.query('INSERT INTO catalog.partner_challenge_use (challenge_id, used_at) VALUES ($1, now())', [input.challengeId]);
  await client.query(
    `INSERT INTO catalog.partner_credential (credential_id, user_id, public_key_spki, algorithm, sign_count, challenge_id, registered_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [input.credentialId, input.userId, input.publicKeySpki, input.algorithm, input.signCount, input.challengeId],
  );
}

/**
 * Défi de connexion. Un identifiant inconnu ou désactivé reçoit un défi
 * indiscernable, jamais enregistré : la connexion échouera sans révéler
 * l'existence du compte (SEC-API-003).
 */
export async function issuePartnerLoginChallenge(client: SqlClient, login: string): Promise<{ readonly challengeId: string; readonly challenge: Buffer }> {
  const challengeId = randomUUID();
  const challenge = randomBytes(32);
  const user = (await client.query<{ id: string }>(
    `SELECT u.id FROM catalog.partner_user u
      WHERE u.login = $1 AND NOT EXISTS (SELECT 1 FROM catalog.partner_user_disable x WHERE x.user_id = u.id)`,
    [login],
  )).rows[0];
  if (user !== undefined) {
    await client.query(
      `INSERT INTO catalog.partner_challenge
         (id, user_id, purpose, challenge, enrollment_token_hash, issued_by_user, issued_by_staff, issued_at, expires_at)
       VALUES ($1, $2, 'LOGIN', $3, NULL, NULL, NULL, now(), now())`,
      [challengeId, user.id, challenge],
    );
  }
  return Object.freeze({ challengeId, challenge });
}

/** Clé du compte avec le dernier compteur connu ; null si la clé n'est pas celle du compte. */
export async function getPartnerCredential(
  client: SqlClient,
  input: { readonly credentialId: Buffer; readonly userId: string },
): Promise<{ readonly publicKeySpki: Buffer; readonly signCount: number } | null> {
  const row = (await client.query<{ public_key_spki: Buffer; sign_count: string }>(
    `SELECT c.public_key_spki,
            GREATEST(c.sign_count, COALESCE((SELECT max(a.sign_count) FROM catalog.partner_assertion a WHERE a.credential_id = c.credential_id), 0))::text AS sign_count
       FROM catalog.partner_credential c WHERE c.credential_id = $1 AND c.user_id = $2`,
    [input.credentialId, input.userId],
  )).rows[0];
  return row === undefined ? null : { publicKeySpki: row.public_key_spki, signCount: Number(row.sign_count) };
}

/** Assertion vérifiée par le flux : défi consommé, compteur enregistré, session de 15 min ; jeton rendu une seule fois. */
export async function recordPartnerLogin(
  client: SqlClient,
  input: { readonly challengeId: string; readonly userId: string; readonly credentialId: Buffer; readonly signCount: number },
): Promise<{ readonly sessionToken: string; readonly expiresAt: string }> {
  const assertionId = randomUUID();
  const sessionToken = randomBytes(32).toString('base64url');
  await client.query('INSERT INTO catalog.partner_challenge_use (challenge_id, used_at) VALUES ($1, now())', [input.challengeId]);
  await client.query(
    'INSERT INTO catalog.partner_assertion (id, credential_id, sign_count, challenge_id, asserted_at) VALUES ($1, $2, $3, $4, now())',
    [assertionId, input.credentialId, input.signCount, input.challengeId],
  );
  const session = await client.query<{ expires_at: Date }>(
    `INSERT INTO catalog.partner_session (id, user_id, token_hash, assertion_id, created_at, expires_at)
     VALUES ($1, $2, $3, $4, now(), now()) RETURNING expires_at`,
    [randomUUID(), input.userId, sha256(sessionToken), assertionId],
  );
  return Object.freeze({ sessionToken, expiresAt: (session.rows[0]?.expires_at ?? new Date(0)).toISOString() });
}

/** SEC-AUTHZ-001 : principal reconstruit depuis une session non expirée, non révoquée, d'un compte actif ; null sinon. */
export async function resolvePartnerPrincipal(client: SqlClient, sessionToken: string): Promise<PartnerPrincipal | null> {
  const row = (await client.query<{ id: string; login: string; partner_id: string; role: PartnerRole }>(
    `SELECT u.id, u.login, u.partner_id, u.role
       FROM catalog.partner_session s
       JOIN catalog.partner_user u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > clock_timestamp()
        AND NOT EXISTS (SELECT 1 FROM catalog.partner_session_revocation v WHERE v.session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM catalog.partner_user_disable x WHERE x.user_id = u.id)`,
    [sha256(sessionToken)],
  )).rows[0];
  if (row === undefined) {
    return null;
  }
  return Object.freeze({ userId: row.id, login: row.login, partnerId: row.partner_id, role: row.role });
}

export async function revokePartnerSession(client: SqlClient, sessionToken: string): Promise<void> {
  await client.query(
    `INSERT INTO catalog.partner_session_revocation (session_id, revoked_at)
     SELECT s.id, now() FROM catalog.partner_session s WHERE s.token_hash = $1 ON CONFLICT DO NOTHING`,
    [sha256(sessionToken)],
  );
}

/**
 * F-PRT-004 : compte vendeur du partenaire donné ; null pour un compte
 * inconnu, d'un autre partenaire ou gérant (même réponse, aucun oracle).
 */
export async function findPartnerSeller(client: SqlClient, input: { readonly userId: string; readonly partnerId: string }): Promise<{ readonly userId: string } | null> {
  const row = (await client.query<{ id: string }>(
    `SELECT id FROM catalog.partner_user WHERE id = $1 AND partner_id = $2 AND role = 'SELLER'`,
    [input.userId, input.partnerId],
  )).rows[0];
  return row === undefined ? null : { userId: row.id };
}

/** F-PRT-003 : comptes du seul partenaire du gérant, désactivés compris. */
export async function listPartnerUsers(
  client: SqlClient,
  partnerId: string,
): Promise<readonly { readonly userId: string; readonly login: string; readonly role: PartnerRole; readonly active: boolean }[]> {
  const rows = await client.query<{ id: string; login: string; role: PartnerRole; active: boolean }>(
    `SELECT u.id, u.login, u.role, NOT EXISTS (SELECT 1 FROM catalog.partner_user_disable x WHERE x.user_id = u.id) AS active
       FROM catalog.partner_user u WHERE u.partner_id = $1 ORDER BY u.role, u.login`,
    [partnerId],
  );
  return rows.rows.map((row) => Object.freeze({ userId: row.id, login: row.login, role: row.role, active: row.active }));
}

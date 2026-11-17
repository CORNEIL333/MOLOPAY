import { timingSafeEqual } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { verifyAssertion, verifyRegistration, type RelyingParty } from '../modules/admin/webauthn';
import {
  getLivePartnerChallenge,
  getPartnerCredential,
  recordPartnerCredential,
  recordPartnerLogin,
  refusePartnerAuth,
  sha256,
} from '../modules/catalog/partner-user.store';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * D63 (SEC-AUTH-006) : vérification WebAuthn des partenaires avec la même
 * implémentation que le personnel (ADR-0007 proposé), mais avec la partie de
 * confiance du portail partenaire et un code d'échec propre : une preuve
 * destinée au back-office n'est jamais acceptée ici (RP ID et origine
 * distincts). À appeler dans une transaction.
 */
function asPartnerFailure<T>(action: () => T): T {
  try {
    return action();
  } catch (error: unknown) {
    if (error instanceof BusinessError && error.code === 'STAFF_AUTH_INVALID') {
      refusePartnerAuth();
    }
    throw error;
  }
}

export async function registerPartnerCredential(
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
  const challenge = await getLivePartnerChallenge(client, input.challengeId, 'REGISTER');
  if (challenge.enrollmentTokenHash === null || !timingSafeEqual(sha256(input.enrollmentToken), challenge.enrollmentTokenHash)) {
    refusePartnerAuth();
  }
  const registered = asPartnerFailure(() => verifyRegistration({ ...input, expectedChallenge: challenge.challenge }));
  await recordPartnerCredential(client, { challengeId: input.challengeId, userId: challenge.userId, ...registered });
}

export async function loginPartner(
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
  const challenge = await getLivePartnerChallenge(client, input.challengeId, 'LOGIN');
  const credential = await getPartnerCredential(client, { credentialId: input.credentialId, userId: challenge.userId });
  if (credential === null) {
    refusePartnerAuth();
  }
  const verified = asPartnerFailure(() =>
    verifyAssertion({
      rp: input.rp,
      expectedChallenge: challenge.challenge,
      credential,
      clientDataJSON: input.clientDataJSON,
      authenticatorData: input.authenticatorData,
      signature: input.signature,
    }),
  );
  return recordPartnerLogin(client, {
    challengeId: input.challengeId,
    userId: challenge.userId,
    credentialId: input.credentialId,
    signCount: verified.signCount,
  });
}

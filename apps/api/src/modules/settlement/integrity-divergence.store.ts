import type { PoolClient } from 'pg';
import { uuidv7 } from '../ledger/domain';

type SqlClient = Pick<PoolClient, 'query'>;

/** Issue d'une exécution du vérificateur indépendant (codes de sortie de `tools/verifier`). */
export type VerifierOutcome =
  | { readonly kind: 'VERIFIED' }
  | { readonly kind: 'DIVERGENCE'; readonly code: string }
  | { readonly kind: 'NOT_RUN' };

const FAILURE = /^VERIFICATION_FAILED ([A-Z][A-Z0-9_]{2,63})(?:\s|$)/m;

/**
 * INT-VER-002 : 0 = vérifié ; 1 = divergence (code du vérificateur, ou code
 * générique si la sortie est illisible : une divergence n'est jamais ignorée) ;
 * tout autre résultat = vérification non exécutée (usage, export illisible,
 * binaire absent) : alerte, sans gel.
 */
export function parseVerifierOutcome(status: number | null, stderr: string): VerifierOutcome {
  if (status === 0) return { kind: 'VERIFIED' };
  if (status === 1) return { kind: 'DIVERGENCE', code: FAILURE.exec(stderr)?.[1] ?? 'VERIFIER_DIVERGENCE' };
  return { kind: 'NOT_RUN' };
}

/** Enregistre la divergence (rôle `integrity_reporter`) : la base gèle aussitôt les flux sortants. */
export async function recordIntegrityDivergence(client: SqlClient, code: string): Promise<string> {
  const id = uuidv7();
  await client.query(
    `INSERT INTO settlement.integrity_divergence (id, source, code, reported_by, detected_at)
     VALUES ($1, 'LEDGER_VERIFIER', $2, current_user, now())`,
    [id, code],
  );
  return id;
}

import { createHash } from 'node:crypto';
import { canonicalize, type JsonValue } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { withTransaction, type Database } from './database';

// Contrat OpenAPI : 16 à 128 caractères ; ASCII imprimable sans espace.
const KEY_PATTERN = /^[\x21-\x7E]{16,128}$/;

export type CommandResult = {
  readonly status: number;
  readonly body: JsonValue;
};

export type IdempotentResult = CommandResult & {
  /** Vrai si la réponse est celle d'une exécution antérieure. */
  readonly replayed: boolean;
};

/** Valide l'en-tête Idempotency-Key ; absent ou mal formé → 400. */
export function assertIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) {
    throw new BusinessError(
      'REQUEST_INVALID',
      'En-tête Idempotency-Key obligatoire (16 à 128 caractères imprimables)',
    );
  }
  return value;
}

function requestHash(request: JsonValue): Buffer {
  return createHash('sha256').update(canonicalize(request), 'utf8').digest();
}

/**
 * Exécute une commande au plus une fois par (portée, clé) (INT-IDEM-001).
 * La clé est insérée dans la transaction de la commande : une requête
 * concurrente avec la même clé attend sur l'index unique, puis rejoue la
 * réponse enregistrée. Même clé avec un contenu différent → 409. Une commande
 * en échec annule tout : la clé n'est pas consommée et peut être rejouée.
 * La portée doit inclure l'appelant authentifié et la route.
 */
export async function runIdempotent(
  database: Database,
  input: { readonly scope: string; readonly key: string; readonly request: JsonValue },
  command: (client: PoolClient) => Promise<CommandResult>,
): Promise<IdempotentResult> {
  const key = assertIdempotencyKey(input.key);
  const hash = requestHash(input.request);
  return withTransaction(database, async (client) => {
    const inserted = await client.query(
      `INSERT INTO api.idempotency_record (scope, idempotency_key, request_hash, created_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (scope, idempotency_key) DO NOTHING
       RETURNING scope`,
      [input.scope, key, hash],
    );
    if (inserted.rowCount === 0) {
      const existing = await client.query<{
        request_hash: Buffer;
        response_status: number | null;
        response_body: JsonValue | null;
      }>(
        `SELECT request_hash, response_status, response_body
         FROM api.idempotency_record WHERE scope = $1 AND idempotency_key = $2`,
        [input.scope, key],
      );
      const row = existing.rows[0];
      if (row === undefined || !row.request_hash.equals(hash)) {
        throw new BusinessError(
          'IDEMPOTENCY_KEY_REUSED',
          'Clé déjà utilisée pour une autre requête',
        );
      }
      if (row.response_status === null || row.response_body === null) {
        throw new BusinessError('REQUEST_CONFLICT', 'Requête identique en cours');
      }
      return { status: row.response_status, body: row.response_body, replayed: true };
    }
    const result = await command(client);
    if (!Number.isInteger(result.status) || result.status < 200 || result.status > 299) {
      throw new BusinessError('INTERNAL_ERROR', 'Seul un succès est mémorisé');
    }
    await client.query(
      `UPDATE api.idempotency_record
       SET response_status = $3, response_body = $4::jsonb, completed_at = now()
       WHERE scope = $1 AND idempotency_key = $2`,
      [input.scope, key, result.status, JSON.stringify(result.body)],
    );
    return { ...result, replayed: false };
  });
}

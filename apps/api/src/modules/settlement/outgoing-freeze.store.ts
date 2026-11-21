import type { PoolClient } from 'pg';
import { BusinessError } from '@achat/contracts';
import { uuidv7 } from '../ledger/domain';

type SqlClient = Pick<PoolClient, 'query'>;

export type FreezeAction = 'FREEZE' | 'UNFREEZE';

export type FreezeState = {
  readonly frozen: boolean;
  /** Instant de la confirmation du gel en cours (null : flux ouverts). */
  readonly since: string | null;
  /** Motif de la demande de gel en cours (null : flux ouverts). */
  readonly reason: string | null;
  /** Demandes encore confirmables (moins d'une heure), pour la seconde personne. */
  readonly pending: readonly { readonly requestId: string; readonly action: FreezeAction; readonly reason: string; readonly requestedBy: string; readonly requestedAt: string }[];
};

/** C7 / SEC-INC-003 : demande motivée de gel ou de levée ; la base refuse une action sans effet sur l'état courant. */
export async function requestOutgoingFreeze(client: SqlClient, input: { readonly action: FreezeAction; readonly reason: string; readonly actorId: string }): Promise<string> {
  const id = uuidv7();
  await client.query(
    'INSERT INTO settlement.outgoing_freeze_request (id, action, reason, requested_by, requested_at) VALUES ($1, $2, $3, $4, now())',
    [id, input.action, input.reason, input.actorId],
  );
  return id;
}

/** Confirmation par une autre personne, dans l'heure (vérifiée par la base) ; renvoie l'état résultant. */
export async function confirmOutgoingFreeze(client: SqlClient, input: { readonly requestId: string; readonly actorId: string }): Promise<boolean> {
  const already = await client.query('SELECT 1 FROM settlement.outgoing_freeze_confirmation WHERE request_id = $1', [input.requestId]);
  if (already.rowCount !== 0) {
    throw new BusinessError('REQUEST_CONFLICT', 'Demande déjà confirmée');
  }
  await client.query('INSERT INTO settlement.outgoing_freeze_confirmation (request_id, confirmed_by, confirmed_at) VALUES ($1, $2, now())', [input.requestId, input.actorId]);
  const row = (await client.query<{ frozen: boolean }>('SELECT settlement.outgoing_frozen() AS frozen')).rows[0];
  return row?.frozen ?? false;
}

/** État courant, motif et demandes en attente (aucune donnée personnelle). */
export async function readOutgoingFreezeState(client: SqlClient): Promise<FreezeState> {
  const current = (await client.query<{ action: string; reason: string; confirmed_at: Date }>(
    `SELECT r.action, r.reason, c.confirmed_at FROM settlement.outgoing_freeze_confirmation c
       JOIN settlement.outgoing_freeze_request r ON r.id = c.request_id
      ORDER BY c.confirmed_at DESC, c.request_id DESC LIMIT 1`,
  )).rows[0];
  const pending = (await client.query<{ id: string; action: FreezeAction; reason: string; requested_by: string; requested_at: Date }>(
    `SELECT r.id, r.action, r.reason, r.requested_by, r.requested_at FROM settlement.outgoing_freeze_request r
      WHERE NOT EXISTS (SELECT 1 FROM settlement.outgoing_freeze_confirmation c WHERE c.request_id = r.id)
        AND r.requested_at > clock_timestamp() - interval '1 hour'
      ORDER BY r.requested_at, r.id`,
  )).rows;
  const frozen = current?.action === 'FREEZE';
  return {
    frozen,
    since: frozen && current !== undefined ? current.confirmed_at.toISOString() : null,
    reason: frozen && current !== undefined ? current.reason : null,
    pending: pending.map((row) => ({ requestId: row.id, action: row.action, reason: row.reason, requestedBy: row.requested_by, requestedAt: row.requested_at.toISOString() })),
  };
}

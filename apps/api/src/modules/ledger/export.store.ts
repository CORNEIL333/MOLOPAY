import type { JsonValue } from '@achat/chain';
import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

/** Écriture au format d'export lu par le vérificateur indépendant (INT-VER-001). */
export type ExportedEntry = {
  readonly seq: number;
  readonly id: string;
  readonly ts: string;
  readonly type: string;
  readonly refs: Readonly<Record<string, JsonValue>>;
  readonly postings: readonly { readonly account_id: string; readonly amount_xaf: string; readonly direction: 'D' | 'C'; readonly ordinal: number }[];
  readonly actor: string;
  readonly approvers: readonly string[];
  readonly idem_scope: string;
  readonly idem_key: string;
  readonly reverses_entry_id: string | null;
  readonly prev_hash: string;
  readonly entry_hash: string;
};

/**
 * INT-VER-001 / F-REP : toutes les écritures dans l'ordre de la chaîne, avec
 * exactement le contenu haché (horodatage à la milliseconde UTC, montants en
 * chaîne d'entiers). Lecture seule, sous un même instantané.
 */
export async function exportLedgerEntries(client: SqlClient): Promise<readonly ExportedEntry[]> {
  const entries = await client.query<{
    seq: string; id: string; ts: string; operation_type: string; business_refs: Record<string, JsonValue>;
    actor_id: string; approvers: string[]; idem_scope: string; idem_key: string; reverses_entry_id: string | null;
    prev_hash: Buffer; entry_hash: Buffer;
  }>(
    `SELECT seq::text, id, to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ts,
            operation_type, business_refs, actor_id, approvers, idem_scope, idem_key, reverses_entry_id,
            prev_hash, entry_hash
       FROM ledger.journal_entry ORDER BY seq`,
  );
  const postings = await client.query<{ entry_id: string; account_id: string; amount_xaf: string; direction: 'D' | 'C'; ordinal: number }>(
    'SELECT entry_id, account_id, amount_xaf::text, direction, ordinal FROM ledger.posting ORDER BY entry_id, ordinal',
  );
  const byEntry = new Map<string, ExportedEntry['postings'][number][]>();
  for (const row of postings.rows) {
    byEntry.set(row.entry_id, [
      ...(byEntry.get(row.entry_id) ?? []),
      { account_id: row.account_id, amount_xaf: row.amount_xaf, direction: row.direction, ordinal: row.ordinal },
    ]);
  }
  return entries.rows.map((row) => ({
    seq: Number(row.seq),
    id: row.id,
    ts: row.ts,
    type: row.operation_type,
    refs: row.business_refs,
    postings: byEntry.get(row.id) ?? [],
    actor: row.actor_id,
    approvers: row.approvers,
    idem_scope: row.idem_scope,
    idem_key: row.idem_key,
    reverses_entry_id: row.reverses_entry_id,
    prev_hash: row.prev_hash.toString('hex'),
    entry_hash: row.entry_hash.toString('hex'),
  }));
}

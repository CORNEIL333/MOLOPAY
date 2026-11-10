import { computeEntryHash, type EntryContent, type EntryPosting } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { assertEntryDraft, uuidv7, type EntryDraft } from './domain';

// Un Client ou un PoolClient suffit : le store n'utilise que `query`.
type SqlClient = Pick<PoolClient, 'query'>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// CDC_04 § 2.1 : passif envers les clients, un compte par client.
const CLIENT_FUNDS_CODE = '2100';
// Horodatage serveur, UTC, à la milliseconde (format attendu par INT-HASH-001).
const SERVER_TS_SQL =
  `to_char(date_trunc('milliseconds', clock_timestamp()) AT TIME ZONE 'UTC', ` +
  `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export type AppendedEntry = {
  readonly id: string;
  readonly seq: number;
  readonly recordedAt: string;
  readonly entryHash: Buffer;
  readonly replayed: boolean;
};

type ExistingRow = {
  id: string;
  seq: string;
  ts: string;
  prev_hash: Buffer;
  entry_hash: Buffer;
};

function invalid(message: string): never {
  throw new BusinessError('LEDGER_INVALID_DRAFT', message);
}

function contentOf(draft: EntryDraft, id: string, seq: number, ts: string): EntryContent {
  const postings: EntryPosting[] = draft.postings.map((posting, index) => ({
    accountId: posting.accountId,
    direction: posting.direction === 'DEBIT' ? 'D' : 'C',
    amountXaf: posting.amount.amount,
    ordinal: index + 1,
  }));
  return {
    seq,
    id,
    ts,
    type: draft.operationType,
    refs: draft.businessRefs,
    postings,
    actor: draft.actorId,
    approvers: [...draft.approvers],
    idemScope: draft.idemScope,
    idemKey: draft.idemKey,
    reversesEntryId: null,
  };
}

/**
 * Ajoute une écriture au grand livre (INT-LED-001/007, INT-HASH-001/002).
 *
 * À appeler dans la transaction du changement d'état métier (I-6). Prend le
 * verrou de chaîne en premier, attribue séquence et `prev_hash` sous verrou,
 * calcule `entry_hash` et laisse la base vérifier équilibre et continuité.
 * Un rejeu de la même clé d'idempotence avec le même contenu renvoie
 * l'écriture originale ; un contenu différent est refusé (I-5).
 * La genèse et les contre-passations (maker-checker) ne passent pas par ici.
 */
export async function appendLedgerEntry(client: SqlClient, draft: EntryDraft): Promise<AppendedEntry> {
  assertEntryDraft(draft);
  if (draft.operationType === 'GENESIS' || draft.postings.length === 0) {
    invalid('la genèse ne passe pas par ce chemin');
  }
  if (draft.reversesEntryId !== undefined) {
    invalid('une contre-passation suit le circuit maker-checker, pas ce chemin');
  }

  await client.query('SELECT ledger.lock_chain()');

  const existing = await client.query<ExistingRow>(
    `SELECT id, seq::text, to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ts,
            prev_hash, entry_hash
       FROM ledger.journal_entry WHERE idem_scope = $1 AND idem_key = $2`,
    [draft.idemScope, draft.idemKey],
  );
  const original = existing.rows[0];
  if (original !== undefined) {
    const seq = Number(original.seq);
    const recomputed = computeEntryHash(original.prev_hash, contentOf(draft, original.id, seq, original.ts));
    if (!recomputed.equals(original.entry_hash)) {
      throw new BusinessError('IDEMPOTENCY_KEY_REUSED', 'clé déjà utilisée pour une autre écriture');
    }
    return Object.freeze({
      id: original.id,
      seq,
      recordedAt: original.ts,
      entryHash: original.entry_hash,
      replayed: true,
    });
  }

  // Tri sur la colonne bigint (et non sur l'alias texte, où '9' > '10').
  const last = await client.query<{ seq: string; entry_hash: Buffer; ts: string }>(
    `SELECT e.seq::text AS seq, e.entry_hash, ${SERVER_TS_SQL} AS ts
       FROM ledger.journal_entry e ORDER BY e.seq DESC LIMIT 1`,
  );
  const previous = last.rows[0];
  if (previous === undefined) {
    invalid('genèse absente : le grand livre n’est pas initialisé');
  }
  const seq = Number(previous.seq) + 1;
  const content = contentOf(draft, draft.id, seq, previous.ts);
  const entryHash = computeEntryHash(previous.entry_hash, content);

  await client.query(
    `INSERT INTO ledger.journal_entry
       (seq, id, recorded_at, operation_type, business_refs, actor_id, approvers,
        idem_scope, idem_key, reverses_entry_id, prev_hash, entry_hash)
     VALUES ($1, $2, $3::timestamptz, $4, $5::jsonb, $6, $7::jsonb, $8, $9, NULL, $10, $11)`,
    [
      seq,
      draft.id,
      previous.ts,
      draft.operationType,
      JSON.stringify(draft.businessRefs),
      draft.actorId,
      JSON.stringify(draft.approvers),
      draft.idemScope,
      draft.idemKey,
      previous.entry_hash,
      entryHash,
    ],
  );
  for (const posting of content.postings) {
    await client.query(
      `INSERT INTO ledger.posting (id, entry_id, account_id, direction, amount_xaf, ordinal)
       VALUES ($1, $2, $3, $4, $5::bigint, $6)`,
      [uuidv7(), draft.id, posting.accountId, posting.direction, posting.amountXaf.toString(), posting.ordinal],
    );
  }
  return Object.freeze({ id: draft.id, seq, recordedAt: previous.ts, entryHash, replayed: false });
}

/** INT-LED-006 : compte 2100 du client (fonds de tiers), créé une seule fois. */
export async function ensureClientFundsAccount(client: SqlClient, customerId: string): Promise<string> {
  if (!UUID_PATTERN.test(customerId)) {
    invalid('identifiant client : UUID attendu');
  }
  await client.query(
    `INSERT INTO ledger.account (id, code, nature, owner_type, owner_id, name)
     VALUES ($1, $2, 'LIABILITY', 'CLIENT', $3, 'Fonds du client — objectifs A et C')
     ON CONFLICT ON CONSTRAINT account_unique_owner DO NOTHING`,
    [uuidv7(), CLIENT_FUNDS_CODE, customerId],
  );
  const result = await client.query<{ id: string }>(
    `SELECT id FROM ledger.account WHERE code = $1 AND owner_type = 'CLIENT' AND owner_id = $2`,
    [CLIENT_FUNDS_CODE, customerId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    invalid('compte client introuvable après création');
  }
  return row.id;
}

/** Compte du plan sans propriétaire (CDC_04 § 2.1), lu par son code. */
export async function systemAccountId(client: SqlClient, code: '1100' | '1200' | '2900'): Promise<string> {
  const result = await client.query<{ id: string }>(
    'SELECT id FROM ledger.account WHERE code = $1 AND owner_type IS NULL',
    [code],
  );
  const row = result.rows[0];
  if (row === undefined) {
    invalid(`compte ${code} absent du plan de comptes`);
  }
  return row.id;
}

/** INT-LED-006 : compte 2200 « fonds dus au partenaire », créé une seule fois. */
export async function ensurePartnerFundsAccount(client: SqlClient, ownerId: string): Promise<string> {
  if (!UUID_PATTERN.test(ownerId)) {
    invalid('identifiant comptable du partenaire : UUID attendu');
  }
  await client.query(
    `INSERT INTO ledger.account (id, code, nature, owner_type, owner_id, name)
     VALUES ($1, '2200', 'LIABILITY', 'PARTNER', $2, 'Fonds dus au partenaire')
     ON CONFLICT ON CONSTRAINT account_unique_owner DO NOTHING`,
    [uuidv7(), ownerId],
  );
  const result = await client.query<{ id: string }>(
    `SELECT id FROM ledger.account WHERE code = '2200' AND owner_type = 'PARTNER' AND owner_id = $1`,
    [ownerId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    invalid('compte partenaire introuvable après création');
  }
  return row.id;
}

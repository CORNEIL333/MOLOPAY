import { BusinessError } from '@achat/contracts';
import { parseXaf } from '@achat/money';
import type { PoolClient } from 'pg';
import {
  createPaymentAttempt,
  isPaymentAttemptStatus,
  isPaymentChannel,
  transitionAttempt,
  type CreatePaymentAttemptInput,
  type PaymentAttempt,
  type PaymentAttemptStatus,
  type PaymentChannel,
} from './domain';

// Un Client ou un PoolClient suffit : le store n'utilise que `query`.
type SqlClient = Pick<PoolClient, 'query'>;

const ACTOR_ID_PATTERN = /^[^\s]{1,200}$/;
const NONCE_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

export type StoredPaymentAttempt = PaymentAttempt & {
  readonly seq: number;
  readonly createdAt: string;
};

type AttemptRow = {
  id: string;
  agreement_id: string;
  channel: string;
  amount_xaf: string;
  idem_key: string;
  created_at: Date;
  status: string;
  seq: number;
};

function invalid(message: string): never {
  throw new BusinessError('PAYMENT_INVALID_REQUEST', message);
}

function fromRow(row: AttemptRow): StoredPaymentAttempt {
  if (!isPaymentChannel(row.channel) || !isPaymentAttemptStatus(row.status)) {
    invalid('ligne de tentative inattendue');
  }
  return Object.freeze({
    id: row.id,
    agreementId: row.agreement_id,
    channel: row.channel,
    amountXaf: parseXaf(row.amount_xaf).amount,
    idemKey: row.idem_key,
    status: row.status,
    seq: row.seq,
    createdAt: row.created_at.toISOString(),
  });
}

const SELECT_STATE =
  'SELECT id, agreement_id, channel, amount_xaf, idem_key, created_at, status, seq ' +
  'FROM payments.attempt_state';

export async function getPaymentAttempt(
  client: SqlClient,
  attemptId: string,
): Promise<StoredPaymentAttempt | null> {
  const result = await client.query<AttemptRow>(`${SELECT_STATE} WHERE id = $1`, [attemptId]);
  const row = result.rows[0];
  return row === undefined ? null : fromRow(row);
}

/**
 * F-PAY-002 / INT-IDEM-001 : crée la tentative ou, si la clé existe déjà
 * avec les mêmes paramètres, renvoie l'originale. Une clé réutilisée avec
 * d'autres paramètres est refusée.
 */
export async function createStoredPaymentAttempt(
  client: SqlClient,
  input: CreatePaymentAttemptInput,
): Promise<StoredPaymentAttempt & { readonly replayed: boolean }> {
  const attempt = createPaymentAttempt(input);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO payments.payment_attempt (id, agreement_id, channel, amount_xaf, idem_key, created_at)
     VALUES ($1, $2, $3, $4::bigint, $5, now())
     ON CONFLICT (idem_key) DO NOTHING
     RETURNING id`,
    [attempt.id, attempt.agreementId, attempt.channel, attempt.amountXaf.toString(), attempt.idemKey],
  );
  const existing = await client.query<AttemptRow>(`${SELECT_STATE} WHERE idem_key = $1`, [
    attempt.idemKey,
  ]);
  const row = existing.rows[0];
  if (row === undefined) {
    invalid('tentative introuvable après insertion');
  }
  const stored = fromRow(row);
  const replayed = inserted.rowCount === 0;
  if (
    replayed &&
    (stored.agreementId !== attempt.agreementId ||
      stored.channel !== attempt.channel ||
      stored.amountXaf !== attempt.amountXaf)
  ) {
    throw new BusinessError('IDEMPOTENCY_KEY_REUSED', 'clé déjà utilisée pour une autre tentative');
  }
  return Object.freeze({ ...stored, replayed });
}

/**
 * Ajoute une transition au journal. La règle est vérifiée ici puis imposée
 * par la base ; CONFIRMED et le remboursement restent refusés par la base
 * tant que le lien vers le grand livre n'existe pas (tranche 2).
 */
export async function appendAttemptTransition(
  client: SqlClient,
  input: {
    readonly attemptId: string;
    readonly from: string;
    readonly to: string;
    readonly seq: number;
    readonly actorId: string;
  },
): Promise<StoredPaymentAttempt> {
  if (!isPaymentAttemptStatus(input.from) || !isPaymentAttemptStatus(input.to)) {
    invalid('statut inconnu');
  }
  if (!Number.isSafeInteger(input.seq) || input.seq < 1) {
    invalid('séquence invalide');
  }
  if (!ACTOR_ID_PATTERN.test(input.actorId)) {
    invalid('acteur invalide');
  }
  const next: PaymentAttemptStatus = transitionAttempt(input.from, input.to, {
    // Aucune confirmation n'est possible dans cette tranche (pas d'adaptateur).
    providerTxVerified: false,
  });
  await client.query(
    `INSERT INTO payments.attempt_event (attempt_id, seq, from_status, to_status, actor_id, created_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [input.attemptId, input.seq, input.from, next, input.actorId],
  );
  const stored = await getPaymentAttempt(client, input.attemptId);
  if (stored === null) {
    invalid('tentative introuvable');
  }
  return stored;
}

/**
 * SEC-API-002 : mémorise le nonce d'un webhook déjà authentifié. Un second
 * passage du même nonce sur le même canal est refusé (WEBHOOK_REPLAYED).
 */
export async function recordWebhookReceipt(
  client: SqlClient,
  input: { readonly channel: string; readonly nonce: string; readonly signedAtMs: number },
): Promise<void> {
  if (!isPaymentChannel(input.channel)) {
    invalid('canal de paiement non autorisé');
  }
  if (!NONCE_PATTERN.test(input.nonce)) {
    invalid('nonce invalide');
  }
  if (!Number.isSafeInteger(input.signedAtMs)) {
    throw new BusinessError('WEBHOOK_TIMESTAMP_OUT_OF_WINDOW', 'horodatage invalide');
  }
  const channel: PaymentChannel = input.channel;
  const result = await client.query(
    `INSERT INTO payments.webhook_receipt (channel, nonce, signed_at, received_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (channel, nonce) DO NOTHING`,
    [channel, input.nonce, new Date(input.signedAtMs).toISOString()],
  );
  if (result.rowCount === 0) {
    throw new BusinessError('WEBHOOK_REPLAYED', 'webhook déjà reçu');
  }
}

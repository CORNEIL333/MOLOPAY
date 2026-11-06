import type { Pool, PoolClient } from 'pg';
import { BusinessError } from '@achat/contracts';
import { parseNotificationEnvelope, type NotificationEnvelope } from './outbox.store';

export type NotificationClaim = NotificationEnvelope & Readonly<{
  claimId: string; attempt: number; leaseUntil: string;
}>;
export type DispatchCounts = Readonly<{
  pending: bigint; leased: bigint; retryWait: bigint; exhausted: bigint; deferredReminders: bigint;
}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pool réservé au rôle notification_worker ; aucune requête externe dans la transaction. */
async function committed<T>(pool: Pick<Pool, 'connect'>, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); }
    catch { discard = true; } // Conserver l'erreur initiale, retirer la connexion inutilisable.
    throw error;
  } finally { client.release(discard); }
}

/** La prise est commitée avant restitution. Un bail ne constitue aucune preuve d'envoi. */
export async function claimNotification(pool: Pick<Pool, 'connect'>): Promise<NotificationClaim | null> {
  return committed(pool, async (client) => {
    const result = await client.query<Record<string, unknown>>('SELECT * FROM notifications.claim_notification()');
    if (result.rows.length === 0) return null;
    const row = result.rows[0]!;
    const date = row['lease_until'];
    if (result.rows.length !== 1 || typeof row['claim_id'] !== 'string' || !UUID.test(row['claim_id'])
      || !Number.isInteger(row['attempt']) || (row['attempt'] as number) < 1 || (row['attempt'] as number) > 1000
      || !(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('NOTIFICATION_DISPATCH_INVALID_RESULT');
    const envelope = parseNotificationEnvelope({ recipientId: row['recipient_id'], eventKey: row['event_key'],
      event: row['event_type'], locale: row['locale'], channel: row['channel'] });
    return Object.freeze({ ...envelope, claimId: row['claim_id'], attempt: row['attempt'] as number, leaseUntil: date.toISOString() });
  });
}

/** Un échec rend l'enveloppe reprenable après délai, sans enregistrer de texte libre. */
export async function retryNotification(pool: Pick<Pool, 'connect'>, claimId: string): Promise<void> {
  if (typeof claimId !== 'string' || !UUID.test(claimId)) throw new BusinessError('NOTIFICATION_INVALID_REQUEST');
  await committed(pool, async (client) => {
    await client.query('SELECT notifications.retry_notification($1)', [claimId]);
  });
}

/** Compteurs sans identifiant client ; la supervision active reste à câbler. */
export async function notificationDispatchCounts(pool: Pick<Pool, 'connect'>): Promise<DispatchCounts> {
  return committed(pool, async (client) => {
    const result = await client.query<Record<string, unknown>>('SELECT * FROM notifications.dispatch_counts()');
    const row = result.rows[0];
    const count = (key: string): bigint => {
      const value = row?.[key];
      if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('NOTIFICATION_DISPATCH_INVALID_RESULT');
      return BigInt(value);
    };
    if (result.rows.length !== 1) throw new Error('NOTIFICATION_DISPATCH_INVALID_RESULT');
    return Object.freeze({ pending: count('pending'), leased: count('leased'), retryWait: count('retry_wait'),
      exhausted: count('exhausted'), deferredReminders: count('deferred_reminders') });
  });
}

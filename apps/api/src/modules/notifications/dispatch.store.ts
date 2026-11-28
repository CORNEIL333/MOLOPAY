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

function parseClaim(result: { readonly rows: readonly Record<string, unknown>[] }): NotificationClaim | null {
  if (result.rows.length === 0) return null;
  const row = result.rows[0]!;
  const date = row['lease_until'];
  if (result.rows.length !== 1 || typeof row['claim_id'] !== 'string' || !UUID.test(row['claim_id'])
    || !Number.isInteger(row['attempt']) || (row['attempt'] as number) < 1 || (row['attempt'] as number) > 1000
    || !(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('NOTIFICATION_DISPATCH_INVALID_RESULT');
  const envelope = parseNotificationEnvelope({ recipientId: row['recipient_id'], eventKey: row['event_key'],
    event: row['event_type'], locale: row['locale'], channel: row['channel'] });
  return Object.freeze({ ...envelope, claimId: row['claim_id'], attempt: row['attempt'] as number, leaseUntil: date.toISOString() });
}

/** La prise est commitée avant restitution. Un bail ne constitue aucune preuve d'envoi. */
export async function claimNotification(pool: Pick<Pool, 'connect'>): Promise<NotificationClaim | null> {
  return committed(pool, async (client) => parseClaim(await client.query<Record<string, unknown>>('SELECT * FROM notifications.claim_notification()')));
}

/**
 * D121 (0081) : prise limitée au canal SMS ; rappels seulement entre 8 h et
 * 20 h, heure de Douala (décidé par la base). Le push attend son prestataire (D122).
 */
export async function claimSmsNotification(pool: Pick<Pool, 'connect'>): Promise<NotificationClaim | null> {
  return committed(pool, async (client) => {
    const claim = parseClaim(await client.query<Record<string, unknown>>('SELECT * FROM notifications.claim_sms_notification()'));
    if (claim !== null && claim.channel !== 'SMS') throw new Error('NOTIFICATION_DISPATCH_INVALID_RESULT');
    return claim;
  });
}

/**
 * Numéro protégé (empreinte et chiffré, jamais en clair) du destinataire du
 * bail SMS en cours ; null si le bail est perdu ou le compte n'est plus actif.
 */
export async function claimedSmsRecipient(pool: Pick<Pool, 'connect'>, claimId: string): Promise<{ readonly key: string; readonly ciphertext: string } | null> {
  if (typeof claimId !== 'string' || !UUID.test(claimId)) throw new BusinessError('NOTIFICATION_INVALID_REQUEST');
  return committed(pool, async (client) => {
    const result = await client.query<{ phone_key: unknown; phone_ciphertext: unknown }>('SELECT phone_key, phone_ciphertext FROM notifications.claimed_sms_recipient($1)', [claimId]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0]!;
    if (result.rows.length !== 1 || typeof row.phone_key !== 'string' || typeof row.phone_ciphertext !== 'string') throw new Error('NOTIFICATION_DISPATCH_INVALID_RESULT');
    return Object.freeze({ key: row.phone_key, ciphertext: row.phone_ciphertext });
  });
}

/** Un échec rend l'enveloppe reprenable après délai, sans enregistrer de texte libre. */
export async function retryNotification(pool: Pick<Pool, 'connect'>, claimId: string): Promise<void> {
  if (typeof claimId !== 'string' || !UUID.test(claimId)) throw new BusinessError('NOTIFICATION_INVALID_REQUEST');
  await committed(pool, async (client) => {
    await client.query('SELECT notifications.retry_notification($1)', [claimId]);
  });
}

const PROVIDER_REF = /^[A-Za-z0-9._:-]{1,200}$/;

/**
 * Confirmation d'envoi (migration 0078) : à appeler APRÈS l'acceptation du
 * message par le prestataire, avec sa référence opaque (jamais le texte ni le
 * numéro). Rejouable ; une notification confirmée n'est plus reprise.
 */
export async function completeNotification(pool: Pick<Pool, 'connect'>, claimId: string, providerRef: string): Promise<void> {
  if (typeof claimId !== 'string' || !UUID.test(claimId)) throw new BusinessError('NOTIFICATION_INVALID_REQUEST');
  if (typeof providerRef !== 'string' || !PROVIDER_REF.test(providerRef)) throw new BusinessError('NOTIFICATION_INVALID_REQUEST', 'NOTIFICATION_INVALID_REQUEST: référence du prestataire invalide');
  await committed(pool, async (client) => {
    await client.query('SELECT notifications.complete_notification($1, $2)', [claimId, providerRef]);
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

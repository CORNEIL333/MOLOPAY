import type { PoolClient } from 'pg';
import { BusinessError } from '@achat/contracts';
import { renderNotification, type NotificationEvent } from './domain';

export type NotificationEnvelope = Readonly<{
  recipientId: string; eventKey: string; event: NotificationEvent;
  locale: 'fr' | 'en'; channel: 'SMS' | 'PUSH';
}>;
const KEYS = ['recipientId', 'eventKey', 'event', 'locale', 'channel'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseNotificationEnvelope(input: unknown): NotificationEnvelope {
  const invalid = (): never => { throw new BusinessError('NOTIFICATION_INVALID_REQUEST', 'Enveloppe de notification invalide'); };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) invalid();
  const keys = Reflect.ownKeys(input as object);
  if (keys.length !== KEYS.length || keys.some((key) => typeof key !== 'string' || !KEYS.includes(key))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (keys.some((key) => typeof key !== 'string' || !Object.hasOwn(descriptors[key]!, 'value') || !descriptors[key]!.enumerable)) invalid();
  const value = input as Record<string, unknown>;
  if (typeof value['recipientId'] !== 'string' || !UUID.test(value['recipientId'])
    || typeof value['eventKey'] !== 'string' || !UUID.test(value['eventKey'])) invalid();
  renderNotification({ event: value['event'], locale: value['locale'], channel: value['channel'] });
  return Object.freeze({ ...value }) as NotificationEnvelope;
}

/**
 * Enqueue seulement : aucune confirmation de livraison. Le client appartient à
 * la transaction métier ; aucun COMMIT interne. Les identifiants et l'événement
 * sont fournis par le serveur après autorisation, jamais par un client public.
 */
export async function enqueueNotification(
  client: Pick<PoolClient, 'query'>, input: unknown,
): Promise<Readonly<{ replayed: boolean }>> {
  const value = parseNotificationEnvelope(input);
  const result = await client.query<{ replayed: boolean }>(
    'SELECT notifications.enqueue_notification($1,$2,$3,$4,$5) AS replayed',
    [value.recipientId, value.eventKey, value.event, value.locale, value.channel],
  );
  const row = result.rows[0];
  if (row === undefined || typeof row.replayed !== 'boolean') throw new Error('NOTIFICATION_ENQUEUE_FAILED');
  return Object.freeze({ replayed: row.replayed });
}

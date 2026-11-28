import type { PoolClient } from 'pg';
import { BusinessError } from '@achat/contracts';
import { NOTIFICATION_EVENTS, type NotificationEvent } from './domain';

type SqlClient = Pick<PoolClient, 'query'>;

export type SmsChannelState = {
  readonly eventType: NotificationEvent;
  readonly smsEnabled: boolean;
  readonly setBy: string | null;
  readonly setAt: string | null;
};

const ACTOR = /^[^\s]{1,100}$/;

export function parseNotificationEvent(value: unknown): NotificationEvent {
  if (typeof value !== 'string' || !(NOTIFICATION_EVENTS as readonly string[]).includes(value)) {
    throw new BusinessError('NOTIFICATION_INVALID_REQUEST', 'Type de notification inconnu');
  }
  return value as NotificationEvent;
}

/** D121 : état du canal SMS pour chacun des six types (désactivé tant que personne ne l'a ouvert). */
export async function listSmsChannels(client: SqlClient): Promise<readonly SmsChannelState[]> {
  const result = await client.query<{ event_type: string; enabled: boolean; set_by: string | null; set_at: Date | null }>(
    'SELECT event_type, enabled, set_by, set_at FROM notifications.sms_channel_states()',
  );
  return Object.freeze(result.rows.map((row) => Object.freeze({
    eventType: parseNotificationEvent(row.event_type),
    smsEnabled: row.enabled,
    setBy: row.set_by,
    setAt: row.set_at === null ? null : row.set_at.toISOString(),
  })));
}

/**
 * D121 : bascule SMS d'un type, posée par l'équipe avec un motif ; ajout seul ;
 * état inchangé refusé (NOTIFICATION_CHANNEL_UNCHANGED, par la base).
 */
export async function setSmsChannel(
  client: SqlClient,
  input: { readonly eventType: NotificationEvent; readonly enabled: boolean; readonly actorId: string; readonly reason: string },
): Promise<void> {
  if (typeof input.enabled !== 'boolean' || !ACTOR.test(input.actorId)) {
    throw new BusinessError('NOTIFICATION_INVALID_REQUEST', 'Bascule invalide');
  }
  await client.query('SELECT notifications.set_sms_channel($1, $2, $3, $4)', [parseNotificationEvent(input.eventType), input.enabled, input.actorId, input.reason]);
}

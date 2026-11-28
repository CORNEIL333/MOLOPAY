import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { enqueueNotification } from '../modules/notifications/outbox.store';
import type { NotificationEvent } from '../modules/notifications/domain';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * D121 (fondateur, 28 novembre) : push toujours ; SMS seulement si l'équipe
 * l'a activé pour ce type de notification ; langue déclarée par
 * l'application du client (français par défaut, langue de référence). Les
 * deux réglages sont lus par la base, dans la transaction du fait : une
 * bascule ne change jamais une notification déjà en file.
 */
async function channelsAndLocale(client: SqlClient, customerId: string, event: NotificationEvent): Promise<{ readonly channels: readonly ('PUSH' | 'SMS')[]; readonly locale: 'fr' | 'en' }> {
  const result = await client.query<{ language: string; sms: boolean }>(
    'SELECT identity.preferred_language($1) AS language, notifications.sms_enabled($2) AS sms',
    [customerId, event],
  );
  const row = result.rows[0];
  if (row === undefined || (row.language !== 'fr' && row.language !== 'en') || typeof row.sms !== 'boolean') {
    throw new Error('NOTIFICATION_PREFERENCES_INVALID');
  }
  return { channels: row.sms ? ['PUSH', 'SMS'] : ['PUSH'], locale: row.language };
}

/**
 * Écrit les enveloppes d'un fait métier dans l'outbox, dans la transaction de
 * ce fait (INT-IDEM-004). `eventKey` est déterministe : un rejeu du fait ne
 * duplique aucune notification. Aucun envoi ici (lot 17).
 */
export async function notifyCustomer(
  client: SqlClient,
  input: { readonly customerId: string; readonly event: NotificationEvent; readonly eventKey: string },
): Promise<void> {
  const { channels, locale } = await channelsAndLocale(client, input.customerId, input.event);
  for (const channel of channels) {
    await enqueueNotification(client, {
      recipientId: input.customerId,
      eventKey: input.eventKey,
      event: input.event,
      locale,
      channel,
    });
  }
}

/**
 * Clé d'événement déterministe dérivée d'un fait métier (UUID de version 8,
 * RFC 9562) : le même fait donne toujours la même clé.
 */
export function factKey(...parts: readonly string[]): string {
  const hex = createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex');
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

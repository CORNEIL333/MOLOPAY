import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { enqueueNotification } from '../modules/notifications/outbox.store';
import type { NotificationEvent } from '../modules/notifications/domain';

type SqlClient = Pick<PoolClient, 'query'>;

// F-NOT-001 : SMS et push. Aucune préférence de langue n'est encore stockée :
// le français, langue de référence, s'applique (D47).
const CHANNELS = ['SMS', 'PUSH'] as const;
const DEFAULT_LOCALE = 'fr';

/**
 * Écrit les enveloppes d'un fait métier dans l'outbox, dans la transaction de
 * ce fait (INT-IDEM-004). `eventKey` est déterministe : un rejeu du fait ne
 * duplique aucune notification. Aucun envoi ici (lot 17).
 */
export async function notifyCustomer(
  client: SqlClient,
  input: { readonly customerId: string; readonly event: NotificationEvent; readonly eventKey: string },
): Promise<void> {
  for (const channel of CHANNELS) {
    await enqueueNotification(client, {
      recipientId: input.customerId,
      eventKey: input.eventKey,
      event: input.event,
      locale: DEFAULT_LOCALE,
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

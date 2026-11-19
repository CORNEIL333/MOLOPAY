import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { renderNotification } from './domain';

type SqlClient = Pick<PoolClient, 'query'>;

export type CustomerFeed = {
  readonly items: readonly { readonly notificationId: string; readonly eventType: string; readonly createdAt: string; readonly title: string; readonly body: string }[];
  readonly nextBefore: string | null;
  readonly asOf: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Curseur de la requête : seul `before` (identifiant d'une notification du client) est admis. */
export function parseFeedCursor(query: unknown): string | null {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    throw new BusinessError('REQUEST_INVALID', 'Paramètres invalides');
  }
  const keys = Object.keys(query);
  if (keys.some((key) => key !== 'before')) {
    throw new BusinessError('REQUEST_INVALID', 'Seul le paramètre before est admis');
  }
  const before = (query as Record<string, unknown>)['before'];
  if (before === undefined) return null;
  if (typeof before !== 'string' || !UUID.test(before)) {
    throw new BusinessError('REQUEST_INVALID', 'Curseur invalide');
  }
  return before;
}

/**
 * C5 / F-NOT-001 : fil des notifications du client, par la fonction de la
 * base (session revérifiée, migration 0069). Textes génériques validés, dans
 * la langue enregistrée avec la notification ; 50 par page.
 */
export async function listCustomerFeed(
  client: SqlClient,
  actor: { readonly accountId: string; readonly deviceId: string; readonly sessionId: string },
  before: string | null,
): Promise<CustomerFeed> {
  const rows = (await client.query<{ notification_id: string; event_type: string; locale: string; created_at: Date }>(
    'SELECT * FROM notifications.list_customer_feed($1, $2, $3, $4)',
    [actor.accountId, actor.deviceId, actor.sessionId, before],
  )).rows;
  const items = rows.slice(0, 50).map((row) => {
    const message = renderNotification({ event: row.event_type, locale: row.locale, channel: 'PUSH' });
    return { notificationId: row.notification_id, eventType: row.event_type, createdAt: row.created_at.toISOString(), title: message.title, body: message.body };
  });
  const asOf = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]?.now ?? new Date(0);
  return { items, nextBefore: rows.length > 50 ? (items.at(-1)?.notificationId ?? null) : null, asOf: asOf.toISOString() };
}

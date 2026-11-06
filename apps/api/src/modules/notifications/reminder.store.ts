import type { PoolClient } from 'pg';

/**
 * Réserve un emplacement, pas un envoi. Le quota est commun à SMS et push.
 * Appeler dans la transaction métier si elle existe ; attendre son commit
 * avant tout traitement externe. Un rejeu ne doit jamais déclencher un envoi.
 * L'identifiant de destinataire vient du serveur, jamais d'une route non gardée.
 */
export async function reserveReminder(
  client: Pick<PoolClient, 'query'>,
  input: { readonly recipientId: string; readonly reservationKey: string; readonly channel: 'SMS' | 'PUSH' },
): Promise<{ readonly replayed: boolean }> {
  const result = await client.query<{ replayed: boolean }>(
    'SELECT notifications.reserve_reminder($1,$2,$3) AS replayed',
    [input.recipientId, input.reservationKey, input.channel],
  );
  const row = result.rows[0];
  if (row === undefined || typeof row.replayed !== 'boolean') {
    throw new Error('NOTIFICATION_RESERVATION_FAILED');
  }
  return Object.freeze({ replayed: row.replayed });
}

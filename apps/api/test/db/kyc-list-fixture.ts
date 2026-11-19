import { Client } from 'pg';
import { importUnSanctionsList } from '../../src/modules/kyc/sanctions.store';

/**
 * IMP-1 (revue du 19 novembre) : seul le rôle `kyc_list_importer` importe une
 * version de liste ; le rôle applicatif `app_rw` ne le peut plus. Les tests
 * importent donc sous ce rôle, dans une transaction à part.
 */
export async function asListImporter<T>(connectionUri: string, action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: connectionUri });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE kyc_list_importer');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export function importListAsImporter(
  connectionUri: string,
  input: Parameters<typeof importUnSanctionsList>[1],
): ReturnType<typeof importUnSanctionsList> {
  return asListImporter(connectionUri, (client) => importUnSanctionsList(client, input));
}

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPartnerLedgerOwner } from '../../src/modules/catalog/partner-ledger.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { ensurePartnerFundsAccount } from '../../src/modules/ledger/entry.store';
import { validateLandlord } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
  'db/migrations/0001_ledger.sql',
  'db/migrations/0002_audit.sql',
  'db/migrations/0005_audit_metadata.sql',
  'db/migrations/0010_audit_catalog.sql',
  'db/migrations/0003_admin.sql',
  'db/migrations/0006_admin_clock.sql',
  'db/migrations/0008_catalog_partner.sql',
  'db/migrations/0009_catalog_offer.sql',
  'db/migrations/0013_partner_type_beneficiary.sql',
  'db/migrations/0014_partner_incident.sql',
  'db/migrations/0015_partner_default_lift.sql',
  'db/migrations/0038_partner_ledger_identity.sql',
].map((path) => resolve(process.cwd(), path));

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let container: TestDatabase;
let admin: Client;
let migrationSql: string[];

async function transact<T>(role: 'app_rw' | 'app_ro' | null, action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (role !== null) {
      await client.query(`SET LOCAL ROLE ${role}`);
    }
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

async function failure(action: () => Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  try {
    await action();
  } catch (error: unknown) {
    if (error instanceof BusinessError) {
      return { code: error.code, message: error.message };
    }
    const pg = error as { code?: string; message?: string };
    return { code: pg.code, message: pg.message ?? '' };
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

beforeAll(async () => {
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  migrationSql = await Promise.all(MIGRATIONS.map((path) => readFile(path, 'utf8')));
}, 120_000);

afterAll(async () => {
  await admin.end();
  await container.stop();
});

beforeEach(async () => {
  for (const schema of ['catalog', 'admin', 'audit', 'ledger']) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
});

describe('D42 identifiant comptable des partenaires', () => {
  it('un partenaire non validé n’a pas d’identifiant comptable', async () => {
    expect(await transact('app_ro', (client) => getPartnerLedgerOwner(client, 'landlord-1'))).toBeNull();
  });

  it('la première validation attribue un UUID v7 immuable', async () => {
    await transact('app_rw', (client) => validateLandlord(client, uuidv7()));
    const owner = await transact('app_ro', (client) => getPartnerLedgerOwner(client, 'landlord-1'));
    expect(owner).toMatch(UUID_V7);
  });

  it('une revalidation conserve le même identifiant', async () => {
    await transact('app_rw', (client) => validateLandlord(client, uuidv7()));
    const first = await transact('app_ro', (client) => getPartnerLedgerOwner(client, 'landlord-1'));
    await transact('app_rw', (client) => validateLandlord(client, uuidv7()));
    const second = await transact('app_ro', (client) => getPartnerLedgerOwner(client, 'landlord-1'));
    expect(second).toBe(first);
    const count = await admin.query('SELECT count(*)::int AS n FROM catalog.partner_ledger_identity');
    expect(count.rows[0]).toEqual({ n: 1 });
  });

  it('l’identifiant ne s’attribue pas à la main et ne se modifie pas', async () => {
    const manual = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO catalog.partner_ledger_identity (partner_id, owner_id, assigned_at)
           VALUES ('partner-x', $1, now())`,
          [uuidv7()],
        ),
      ),
    );
    expect(manual.code).toBe('42501');
    await transact('app_rw', (client) => validateLandlord(client, uuidv7()));
    const update = await failure(() => admin.query('UPDATE catalog.partner_ledger_identity SET owner_id = gen_random_uuid()'));
    expect(update.message).toMatch(/^CATALOG_APPEND_ONLY/);
  });

  it('INT-LED-006 crée le compte 2200 du partenaire une seule fois', async () => {
    await transact('app_rw', (client) => validateLandlord(client, uuidv7()));
    const owner = await transact('app_ro', (client) => getPartnerLedgerOwner(client, 'landlord-1'));
    if (owner === null) {
      throw new Error('identifiant attendu');
    }
    const first = await transact('app_rw', (client) => ensurePartnerFundsAccount(client, owner));
    const again = await transact('app_rw', (client) => ensurePartnerFundsAccount(client, owner));
    expect(again).toBe(first);
    const row = await admin.query('SELECT code, nature, owner_type FROM ledger.account WHERE id = $1', [first]);
    expect(row.rows[0]).toEqual({ code: '2200', nature: 'LIABILITY', owner_type: 'PARTNER' });
  });
});

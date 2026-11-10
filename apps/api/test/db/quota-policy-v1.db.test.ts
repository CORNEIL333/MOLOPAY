import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
  '0002_audit.sql',
  '0004_identity.sql',
  '0005_audit_metadata.sql',
  '0007_identity_clock.sql',
  '0017_api_idempotency.sql',
  '0023_identity_account_security.sql',
  '0024_identity_data_rights.sql',
  '0025_identity_customer_quota.sql',
  '0035_quota_policy_v1.sql',
];

let db: TestDatabase;
let admin: Client;
let migrations: string[];

beforeAll(async () => {
  migrations = await Promise.all(MIGRATIONS.map((name) => readFile(resolve('db/migrations', name), 'utf8')));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
}, 120_000);

afterAll(async () => {
  await admin.end();
  await db.stop();
});

beforeEach(async () => {
  for (const schema of ['identity', 'audit', 'api']) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrations) {
    await admin.query(sql);
  }
});

describe('D38 / SEC-API-003 politique de quotas v1', () => {
  it('pose les valeurs décidées le 10 novembre 2026, une version par action', async () => {
    const rows = await admin.query(
      `SELECT action, version, window_seconds, account_limit, device_limit
         FROM identity.customer_quota_policy ORDER BY action`,
    );
    expect(rows.rows).toEqual([
      { action: 'DATA_RIGHTS_READ', version: 1, window_seconds: 3600, account_limit: 30, device_limit: 30 },
      { action: 'DATA_RIGHTS_SUBMIT', version: 1, window_seconds: 86400, account_limit: 5, device_limit: 5 },
      { action: 'REVOKE_OTHERS', version: 1, window_seconds: 3600, account_limit: 5, device_limit: 5 },
      { action: 'SECURITY_READ', version: 1, window_seconds: 3600, account_limit: 60, device_limit: 60 },
    ]);
  });

  it('une politique existante n’est jamais écrasée : la migration ouvre la version suivante', async () => {
    await admin.query('DROP SCHEMA IF EXISTS identity CASCADE');
    await admin.query('DROP SCHEMA IF EXISTS audit CASCADE');
    await admin.query('DROP SCHEMA IF EXISTS api CASCADE');
    for (const sql of migrations.slice(0, -1)) {
      await admin.query(sql);
    }
    await admin.query(
      `INSERT INTO identity.customer_quota_policy (action, version, window_seconds, account_limit, device_limit)
       VALUES ('SECURITY_READ', 1, 60, 2, 2)`,
    );
    await admin.query(migrations.at(-1) ?? '');
    const rows = await admin.query(
      `SELECT version, account_limit FROM identity.customer_quota_policy
        WHERE action = 'SECURITY_READ' ORDER BY version`,
    );
    expect(rows.rows).toEqual([
      { version: 1, account_limit: 2 },
      { version: 2, account_limit: 60 },
    ]);
  });
});

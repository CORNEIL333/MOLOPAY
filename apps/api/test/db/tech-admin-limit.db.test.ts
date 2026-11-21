import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toProblem } from '../../src/http/problem';
import type { InternalRole } from '../../src/modules/admin/domain';
import { insertRoleGrant, insertStaffDisable } from '../../src/modules/admin/staff.store';
import { startTestDatabase, type TestDatabase } from './harness';
import { approvedRoleGrant, createStaffAccount } from './staff-fixture';

/** F-BO-001 : rôle Administrateur technique détenu par deux personnes au plus, imposé par la base. */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];

let db: TestDatabase;
let admin: Client;
let migrations: string[];

async function asAppRw<T>(action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: db.getConnectionUri() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_rw');
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

async function grant(staffId: string, roles: readonly InternalRole[]): Promise<string> {
  const input = { staffId, roles, cityIds: ['douala'], maxAmountXaf: null };
  const approvalRequestId = await approvedRoleGrant(db.getConnectionUri(), input);
  return asAppRw((client) => insertRoleGrant(client, { ...input, approvalRequestId })).then(
    () => 'granted',
    (error: { code?: string; message?: string }) => toProblem(error).code,
  );
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
}, 120_000);

beforeEach(async () => {
  for (const schema of SCHEMAS) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  for (const sql of migrations) await admin.query(sql);
});

afterAll(async () => {
  await admin.end();
  await db.stop();
});

describe('F-BO-001 deux administrateurs techniques au plus', () => {
  it('une troisième personne est refusée (ADMIN_TECH_ADMIN_LIMIT), même approuvée ; les autres rôles restent attribuables', async () => {
    const [one, two, three] = [await createStaffAccount(db.getConnectionUri(), 'tech.un'), await createStaffAccount(db.getConnectionUri(), 'tech.deux'), await createStaffAccount(db.getConnectionUri(), 'tech.trois')];
    expect(await grant(one, ['TECH_ADMIN'])).toBe('granted');
    expect(await grant(two, ['AUDIT', 'TECH_ADMIN'])).toBe('granted');
    expect(await grant(three, ['TECH_ADMIN'])).toBe('ADMIN_TECH_ADMIN_LIMIT');
    expect(await grant(three, ['OPERATIONS', 'TECH_ADMIN'])).toBe('ADMIN_TECH_ADMIN_LIMIT');
    expect(await grant(three, ['OPERATIONS'])).toBe('granted');
    // Un administrateur en place peut voir ses autres rôles changer sans perdre le sien.
    expect(await grant(two, ['TECH_ADMIN'])).toBe('granted');
    expect(toProblem({ code: 'P0001', message: 'ADMIN_TECH_ADMIN_LIMIT: deux administrateurs techniques au plus (F-BO-001)' }).status).toBe(422);
  });

  it('désactivation ou retrait du rôle libère la place ; un compte désactivé ne compte plus', async () => {
    const [one, two, three, four] = await Promise.all(['tech.un', 'tech.deux', 'tech.trois', 'tech.quatre'].map((login) => createStaffAccount(db.getConnectionUri(), login)));
    if (one === undefined || two === undefined || three === undefined || four === undefined) throw new Error('comptes attendus');
    expect(await grant(one, ['TECH_ADMIN'])).toBe('granted');
    expect(await grant(two, ['TECH_ADMIN'])).toBe('granted');
    expect(await grant(two, ['FINANCE'])).toBe('granted');
    expect(await grant(three, ['TECH_ADMIN'])).toBe('granted');
    expect(await grant(four, ['TECH_ADMIN'])).toBe('ADMIN_TECH_ADMIN_LIMIT');
    await asAppRw((client) => insertStaffDisable(client, { staffId: three, actorId: 'tech-1', reason: 'Départ' }));
    expect(await grant(four, ['TECH_ADMIN'])).toBe('granted');
  });

  it('concurrence : deux attributions simultanées pour une seule place restante → une seule acceptée', async () => {
    const [one, two, three] = await Promise.all(['tech.un', 'tech.deux', 'tech.trois'].map((login) => createStaffAccount(db.getConnectionUri(), login)));
    if (one === undefined || two === undefined || three === undefined) throw new Error('comptes attendus');
    expect(await grant(one, ['TECH_ADMIN'])).toBe('granted');
    const outcomes = await Promise.all([grant(two, ['TECH_ADMIN']), grant(three, ['TECH_ADMIN'])]);
    expect([...outcomes].sort()).toEqual(['ADMIN_TECH_ADMIN_LIMIT', 'granted']);
    const holders = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM admin.staff_account s
        WHERE 'TECH_ADMIN' = ANY ((SELECT g.roles FROM admin.staff_role_grant g WHERE g.staff_id = s.id ORDER BY g.granted_at DESC LIMIT 1)::text[])`,
    );
    expect(holders.rows[0]).toEqual({ n: 2 });
  });
});

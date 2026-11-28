import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../../apps/api/test/db/harness';
import { checkRoles, LOGIN_ACCOUNTS, planRoleSql } from '../../tools/db-roles';
import { migrate } from '../../tools/migrate';

/**
 * N3 (ADR-0004, Neon) : comptes de connexion. Chaque composant se connecte
 * avec son propre compte, créé en SQL par le propriétaire (le mot de passe est
 * saisi ensuite par l'opérateur, jamais écrit par nous), membre de SON seul
 * rôle fonctionnel, sans héritage : il
 * n'obtient de droits qu'en prenant ce rôle explicitement. `pnpm db:roles
 * check` refuse tout écart : attribut puissant, propriété d'objets, droit
 * direct, appartenance en trop, héritage.
 */
const DATABASE = 'molopay_roles_test';
const OWNER = 'molopay_migrate_owner';
const FUNCTIONAL = ['app_rw', 'app_ro', 'notification_worker', 'notification_observer', 'integrity_reporter', 'kyc_list_importer'];

let db: TestDatabase;
let admin: Client;
let ownerUrl: string;

async function asOwner<T>(action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

async function asSuper<T>(action: (client: Client) => Promise<T>): Promise<T> {
  const url = new URL(db.getConnectionUri());
  url.pathname = `/${DATABASE}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

async function dropAccounts(): Promise<void> {
  for (const name of Object.keys(LOGIN_ACCOUNTS)) {
    await admin.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${name}') THEN DROP OWNED BY ${name}; DROP ROLE ${name}; END IF; END $$`).catch(async () => {
      await admin.query(`DROP ROLE IF EXISTS ${name}`);
    });
  }
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  const owner = new URL(db.getConnectionUri());
  owner.pathname = `/${DATABASE}`;
  owner.username = OWNER;
  owner.password = '';
  ownerUrl = owner.toString();
}, 300_000);

afterAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
  await dropAccounts();
  await admin.end();
  await db.stop();
});

beforeEach(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
  await dropAccounts();
  await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${OWNER}') THEN CREATE ROLE ${OWNER} LOGIN NOSUPERUSER CREATEROLE CREATEDB; END IF; END $$`);
  await admin.query(`CREATE DATABASE ${DATABASE} OWNER ${OWNER}`);
  await migrate({ url: ownerUrl, directory: `${process.cwd()}/db/migrations` });
  // Sur Neon, le propriétaire a créé les rôles fonctionnels (migrations) et en est donc administrateur ;
  // ici ils existent déjà dans le serveur de test : on lui donne la même capacité.
  for (const role of FUNCTIONAL) await admin.query(`GRANT ${role} TO ${OWNER} WITH ADMIN OPTION, INHERIT FALSE, SET FALSE`);
});

describe('N3 — comptes de connexion Neon à droits minimaux', () => {
  it('le plan crée chaque compte avec son seul rôle, sans héritage, sans mot de passe ; rejouable ; le contrôle passe', async () => {
    expect(LOGIN_ACCOUNTS).toEqual({
      molopay_api: ['app_ro', 'app_rw'],
      molopay_notifier: ['notification_worker'],
      molopay_monitor: ['notification_observer'],
      molopay_nightly: ['integrity_reporter'],
      molopay_kyc_import: ['kyc_list_importer'],
    });
    const sql = planRoleSql();
    expect(sql).not.toMatch(/PASSWORD/i);
    // Option explicite sur chaque appartenance : ne dépend pas de l'attribut NOINHERIT du compte.
    expect(sql.match(/^GRANT .* WITH INHERIT FALSE, SET TRUE;$/gm)?.length).toBe(6);
    expect(sql).not.toMatch(/^GRANT (?!.* WITH INHERIT FALSE, SET TRUE;$)/m);
    await asOwner((client) => client.query(sql));
    await asOwner((client) => client.query(sql));
    expect(await asOwner((client) => checkRoles(client))).toEqual({ status: 'OK', violations: [] });
    // Sans prendre son rôle, le compte de l'API ne lit rien ; en le prenant, il lit.
    const api = new URL(ownerUrl);
    api.username = 'molopay_api';
    const client = new Client({ connectionString: api.toString() });
    await client.connect();
    try {
      await expect(client.query('SELECT count(*) FROM catalog.offer')).rejects.toThrow(/permission denied/);
      await client.query('SET ROLE app_ro');
      await expect(client.query('SELECT count(*) FROM catalog.offer')).resolves.toBeDefined();
      await expect(client.query('SET ROLE integrity_reporter')).rejects.toThrow(/permission denied/);
    } finally {
      await client.end();
    }
  }, 300_000);

  it('refuse : compte absent, attribut puissant, héritage, appartenance en trop ou manquante, droit direct, objet possédé', async () => {
    await asOwner((client) => client.query(planRoleSql()));
    await admin.query('DROP ROLE molopay_kyc_import');
    await admin.query('ALTER ROLE molopay_monitor CREATEDB');
    await admin.query('GRANT app_rw TO molopay_nightly');
    await admin.query('GRANT app_rw TO molopay_api WITH INHERIT TRUE');
    await asOwner((client) => client.query('GRANT SELECT ON ledger.journal_entry TO molopay_notifier'));
    await asSuper((client) => client.query('CREATE TABLE public.possede (id int); ALTER TABLE public.possede OWNER TO molopay_notifier'));
    const report = await asOwner((client) => checkRoles(client));
    expect(report.status).toBe('VIOLATION');
    expect(report.violations).toEqual(expect.arrayContaining([
      'molopay_kyc_import : compte absent',
      'molopay_monitor : attribut interdit (CREATEDB)',
      'molopay_nightly : appartenance en trop (app_rw)',
      'molopay_api : héritage des droits de app_rw (doit être NOINHERIT)',
      'molopay_notifier : droit direct (SELECT sur ledger.journal_entry)',
      'molopay_notifier : possède des objets (1)',
    ]));
  }, 300_000);

  it('refuse : un compte membre d’un rôle prédéfini puissant ou superutilisateur', async () => {
    await asOwner((client) => client.query(planRoleSql()));
    await admin.query('GRANT pg_read_all_data TO molopay_api');
    await admin.query('ALTER ROLE molopay_monitor SUPERUSER');
    const report = await asOwner((client) => checkRoles(client));
    expect(report.violations).toEqual(expect.arrayContaining([
      'molopay_api : appartenance en trop (pg_read_all_data)',
      'molopay_monitor : attribut interdit (SUPERUSER)',
    ]));
  }, 300_000);
});

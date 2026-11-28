import { Client } from 'pg';
import { assertSecureDatabaseUrl } from '../apps/api/src/http/database';

/**
 * N3 (ADR-0004, Neon) : comptes de connexion à droits minimaux.
 *
 * Un compte par composant, membre de ses seuls rôles fonctionnels (créés par
 * les migrations), SANS héritage : le compte n'a aucun droit tant qu'il ne
 * prend pas explicitement son rôle (`SET LOCAL ROLE` dans l'API,
 * `options=-c role=…` pour les outils). Les comptes sont créés en SQL par le
 * propriétaire (qui en est ainsi administrateur), sans mot de passe :
 * l'opérateur le saisit ensuite avec `\password <compte>` dans psql (jamais
 * dans un fichier, un historique ou un message).
 *
 * `pnpm db:roles plan` : SQL à exécuter par le propriétaire (rejouable).
 * `ROLES_DATABASE_URL=… pnpm db:roles check` : refuse tout écart (code 1).
 */
export const LOGIN_ACCOUNTS: Readonly<Record<string, readonly string[]>> = {
  molopay_api: ['app_ro', 'app_rw'],
  molopay_notifier: ['notification_worker'],
  molopay_monitor: ['notification_observer'],
  molopay_nightly: ['integrity_reporter'],
  molopay_kyc_import: ['kyc_list_importer'],
};

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function planRoleSql(accounts: Readonly<Record<string, readonly string[]>> = LOGIN_ACCOUNTS): string {
  const lines: string[] = ['BEGIN;'];
  for (const [account, roles] of Object.entries(accounts)) {
    if (!IDENTIFIER.test(account) || !roles.every((role) => IDENTIFIER.test(role))) throw new Error('ROLE_NAME_INVALID');
    lines.push(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${account}') THEN CREATE ROLE ${account} LOGIN NOINHERIT NOCREATEDB NOCREATEROLE; END IF; END $$;`,
      `ALTER ROLE ${account} NOINHERIT NOCREATEDB NOCREATEROLE;`,
      ...roles.map((role) => `GRANT ${role} TO ${account} WITH INHERIT FALSE, SET TRUE;`),
    );
  }
  lines.push('COMMIT;');
  return `${lines.join('\n')}\n`;
}

type Queryable = Pick<Client, 'query'>;

export type RoleReport = { readonly status: 'OK' | 'VIOLATION'; readonly violations: string[] };

export async function checkRoles(client: Queryable, accounts: Readonly<Record<string, readonly string[]>> = LOGIN_ACCOUNTS): Promise<RoleReport> {
  const violations: string[] = [];
  for (const [account, expected] of Object.entries(accounts)) {
    const role = (await client.query<{ oid: number; rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolreplication: boolean; rolbypassrls: boolean; rolinherit: boolean; rolcanlogin: boolean }>(
      'SELECT oid::int AS oid, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolinherit, rolcanlogin FROM pg_roles WHERE rolname = $1',
      [account],
    )).rows[0];
    if (role === undefined) {
      violations.push(`${account} : compte absent`);
      continue;
    }
    for (const [flag, label] of [['rolsuper', 'SUPERUSER'], ['rolcreaterole', 'CREATEROLE'], ['rolcreatedb', 'CREATEDB'], ['rolreplication', 'REPLICATION'], ['rolbypassrls', 'BYPASSRLS']] as const) {
      if (role[flag]) violations.push(`${account} : attribut interdit (${label})`);
    }
    if (role.rolinherit) violations.push(`${account} : attribut interdit (INHERIT)`);
    if (!role.rolcanlogin) violations.push(`${account} : connexion impossible (NOLOGIN)`);
    const grants = (await client.query<{ granted: string; inherit: boolean }>(
      'SELECT r.rolname AS granted, m.inherit_option AS inherit FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE m.member = $1',
      [role.oid],
    )).rows;
    const granted = new Set(grants.map((grant) => grant.granted));
    for (const name of [...granted].sort()) if (!expected.includes(name)) violations.push(`${account} : appartenance en trop (${name})`);
    for (const name of expected) if (!granted.has(name)) violations.push(`${account} : appartenance manquante (${name})`);
    for (const name of [...new Set(grants.filter((grant) => grant.inherit).map((grant) => grant.granted))].sort()) {
      violations.push(`${account} : héritage des droits de ${name} (doit être NOINHERIT)`);
    }
    const owned = (await client.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM pg_class WHERE relowner = $1) + (SELECT count(*) FROM pg_proc WHERE proowner = $1) + (SELECT count(*) FROM pg_namespace WHERE nspowner = $1))::int AS n`,
      [role.oid],
    )).rows[0]?.n ?? 0;
    if (owned > 0) violations.push(`${account} : possède des objets (${owned})`);
    const direct = (await client.query<{ line: string }>(
      `SELECT a.privilege_type || ' sur ' || n.nspname || '.' || c.relname AS line
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
        WHERE a.grantee = $1
       UNION
       SELECT a.privilege_type || ' sur ' || n.nspname || '.' || p.proname || '()' AS line
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, aclexplode(p.proacl) a
        WHERE a.grantee = $1
       UNION
       SELECT a.privilege_type || ' sur le schéma ' || n.nspname AS line
         FROM pg_namespace n, aclexplode(n.nspacl) a
        WHERE a.grantee = $1
       ORDER BY 1`,
      [role.oid],
    )).rows;
    for (const row of direct) violations.push(`${account} : droit direct (${row.line})`);
  }
  return { status: violations.length === 0 ? 'OK' : 'VIOLATION', violations };
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv.filter((arg) => arg !== '--');
  if (rest.length > 0 || (command !== 'plan' && command !== 'check')) {
    process.stdout.write('{"status":"ERROR","code":"ROLES_ARGUMENTS_INVALID"}\n');
    return 2;
  }
  if (command === 'plan') {
    process.stdout.write(planRoleSql());
    return 0;
  }
  const url = process.env['ROLES_DATABASE_URL']?.trim() ?? '';
  try {
    if (url === '') throw new Error('ROLES_DATABASE_MISSING');
    assertSecureDatabaseUrl(url, process.env);
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const report = await checkRoles(client);
      process.stdout.write(`${JSON.stringify(report)}\n`);
      return report.status === 'OK' ? 0 : 1;
    } finally {
      await client.end();
    }
  } catch (error) {
    const code = error instanceof Error ? (error.message.split(':')[0] ?? 'ROLES_CHECK_FAILED') : 'ROLES_CHECK_FAILED';
    process.stdout.write(`${JSON.stringify({ status: 'ERROR', code })}\n`);
    return 2;
  }
}

if (require.main === module) {
  void main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

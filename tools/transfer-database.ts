import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { assertSecureDatabaseUrl } from '../apps/api/src/http/database';

/**
 * C15 / ADR-0004 : transfert de la base (Neon → AWS RDS/Aurora, ou toute
 * restauration) sans perte ni affaiblissement.
 *
 * 1. Cible vide exigée ; rôles applicatifs créés (NOLOGIN) s'ils manquent.
 * 2. Copie complète cohérente (`pg_dump -Fc --serializable-deferrable`) :
 *    les données sont chargées AVANT les déclencheurs et contraintes (section
 *    post-data), donc nos protections ne réécrivent ni ne refusent rien au
 *    chargement, puis sont recréées à l'identique (y compris ENABLE ALWAYS).
 * 3. Restauration en une seule transaction, droits CONSERVÉS (jamais
 *    `--no-privileges` : on perdrait les REVOKE/GRANT qui protègent la base).
 * 4. Vérification : pour chaque table, nombre de lignes et empreinte du
 *    contenu identiques ; déclencheurs et leur état identiques ; droits des
 *    rôles applicatifs identiques ; grand livre équilibré et sans trou.
 * Toute différence : code 1, la bascule ne doit pas avoir lieu.
 */
export const SCHEMAS = ['ledger', 'audit', 'admin', 'identity', 'catalog', 'agreements', 'payments', 'notifications', 'api', 'settlement', 'reconciliation', 'disputes', 'risk', 'kyc', 'crm', 'ops', 'monitoring'] as const;

export type TransferReport = {
  readonly status: 'VERIFIED' | 'MISMATCH';
  readonly tables: number;
  readonly rows: number;
  readonly mismatches: readonly string[];
};

type Snapshot = {
  readonly tables: ReadonlyMap<string, { readonly rows: number; readonly digest: string }>;
  readonly triggers: readonly string[];
  readonly grants: readonly string[];
  readonly ledger: { readonly unbalanced: number; readonly gaps: number };
};

/** Rôles applicatifs déclarés par les migrations (`CREATE ROLE x NOLOGIN`). */
export function applicationRoles(directory = resolve(process.cwd(), 'db/migrations')): string[] {
  const roles = new Set<string>();
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql'))) {
    for (const match of readFileSync(join(directory, file), 'utf8').matchAll(/CREATE ROLE ([a-z_][a-z0-9_]*)/g)) {
      if (match[1] !== undefined) roles.add(match[1]);
    }
  }
  return [...roles].sort();
}

function run(binary: string, args: readonly string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(binary, [...args], { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    // Message d'outil seulement : aucune donnée de ligne n'est affichée.
    throw new Error(`TRANSFER_TOOL_FAILED ${binary.split('/').pop() ?? binary}: ${(result.stderr ?? '').split('\n').slice(0, 3).join(' ')}`);
  }
}

async function withClient<T>(url: string, action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

export async function assertEmptyTarget(url: string): Promise<void> {
  const count = await withClient(url, async (client) => (await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S') AND n.nspname = ANY($1::text[])`,
    [[...SCHEMAS]],
  )).rows[0]?.n ?? -1);
  if (count !== 0) throw new Error('TARGET_NOT_EMPTY: la cible doit être une base vide');
}

export async function ensureRoles(url: string, roles: readonly string[]): Promise<void> {
  await withClient(url, async (client) => {
    for (const role of roles) {
      if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error('ROLE_NAME_INVALID');
      await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
    }
  });
}

/** Empreinte comparable des deux côtés (indépendante du propriétaire et de l'ordre physique). */
export async function snapshot(url: string, roles: readonly string[]): Promise<Snapshot> {
  return withClient(url, async (client) => {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const names = (await client.query<{ name: string }>(
        `SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname) AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' AND n.nspname = ANY($1::text[]) ORDER BY 1`,
        [[...SCHEMAS]],
      )).rows.map((row) => row.name);
      const tables = new Map<string, { rows: number; digest: string }>();
      for (const name of names) {
        const row = (await client.query<{ rows: number; digest: string | null }>(
          `SELECT count(*)::int AS rows, md5(string_agg(t::text, E'\\n' ORDER BY t::text)) AS digest FROM ${name} t`,
        )).rows[0];
        tables.set(name, { rows: row?.rows ?? -1, digest: row?.digest ?? 'vide' });
      }
      const triggers = (await client.query<{ line: string }>(
        `SELECT n.nspname || '.' || c.relname || ':' || t.tgname || ':' || t.tgenabled::text AS line
           FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE NOT t.tgisinternal AND n.nspname = ANY($1::text[]) ORDER BY 1`,
        [[...SCHEMAS]],
      )).rows.map((row) => row.line);
      const grants = (await client.query<{ line: string }>(
        `SELECT grantee || ':' || table_schema || '.' || table_name || ':' || privilege_type AS line
           FROM information_schema.role_table_grants
          WHERE grantee = ANY($1::text[]) AND table_schema = ANY($2::text[])
         UNION ALL
         SELECT r.rolname || ':' || n.nspname || '.' || p.proname || ':EXECUTE'
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, pg_roles r
          WHERE n.nspname = ANY($2::text[]) AND r.rolname = ANY($1::text[]) AND has_function_privilege(r.oid, p.oid, 'EXECUTE')
          ORDER BY 1`,
        [[...roles], [...SCHEMAS]],
      )).rows.map((row) => row.line);
      const ledger = (await client.query<{ unbalanced: number; gaps: number }>(
        `SELECT
           (SELECT count(*)::int FROM (SELECT entry_id FROM ledger.posting GROUP BY entry_id
              HAVING sum(CASE direction WHEN 'D' THEN amount_xaf ELSE -amount_xaf END) <> 0) u) AS unbalanced,
           (SELECT count(*)::int FROM (SELECT seq, lag(seq) OVER (ORDER BY seq) AS previous FROM ledger.journal_entry) s
             WHERE previous IS NOT NULL AND seq <> previous + 1) AS gaps`,
      )).rows[0] ?? { unbalanced: -1, gaps: -1 };
      return { tables, triggers, grants, ledger };
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

export function compare(source: Snapshot, target: Snapshot): TransferReport {
  const mismatches: string[] = [];
  for (const [name, expected] of source.tables) {
    const actual = target.tables.get(name);
    if (actual === undefined) mismatches.push(`table absente : ${name}`);
    else if (actual.rows !== expected.rows || actual.digest !== expected.digest) mismatches.push(`contenu différent : ${name}`);
  }
  for (const name of target.tables.keys()) if (!source.tables.has(name)) mismatches.push(`table en trop : ${name}`);
  const diff = (label: string, a: readonly string[], b: readonly string[]): void => {
    const left = new Set(a);
    const right = new Set(b);
    for (const item of a) if (!right.has(item)) mismatches.push(`${label} manquant : ${item}`);
    for (const item of b) if (!left.has(item)) mismatches.push(`${label} en trop : ${item}`);
  };
  diff('déclencheur', source.triggers, target.triggers);
  diff('droit', source.grants, target.grants);
  if (target.ledger.unbalanced !== 0 || target.ledger.gaps !== 0) mismatches.push('grand livre : écriture déséquilibrée ou trou de séquence');
  const rows = [...source.tables.values()].reduce((sum, table) => sum + table.rows, 0);
  return { status: mismatches.length === 0 ? 'VERIFIED' : 'MISMATCH', tables: source.tables.size, rows, mismatches };
}

/** Transfert complet et vérifié ; `pgBin` : répertoire des binaires PostgreSQL (version ≥ serveur source). */
export async function transferDatabase(input: { readonly sourceUrl: string; readonly targetUrl: string; readonly pgBin?: string }): Promise<TransferReport> {
  const bin = (name: string): string => (input.pgBin === undefined ? name : join(input.pgBin, name));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('PG')) delete env[key];
  // N2 : source (Neon) et cible (AWS) jointes en TLS vérifié uniquement.
  assertSecureDatabaseUrl(input.sourceUrl, process.env);
  assertSecureDatabaseUrl(input.targetUrl, process.env);
  const roles = applicationRoles();
  await assertEmptyTarget(input.targetUrl);
  await ensureRoles(input.targetUrl, roles);
  const work = mkdtempSync(join(tmpdir(), 'molopay-transfer-'));
  try {
    const dump = join(work, 'base.dump');
    run(bin('pg_dump'), ['--format=custom', '--serializable-deferrable', '--no-owner', ...SCHEMAS.flatMap((schema) => ['--schema', schema]), '--file', dump, '--dbname', input.sourceUrl], env);
    run(bin('pg_restore'), ['--exit-on-error', '--single-transaction', '--no-owner', '--dbname', input.targetUrl, dump], env);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return compare(await snapshot(input.sourceUrl, roles), await snapshot(input.targetUrl, roles));
}

async function main(): Promise<number> {
  const source = process.env['TRANSFER_SOURCE_URL'];
  const target = process.env['TRANSFER_TARGET_URL'];
  if (source === undefined || target === undefined || source === target) {
    process.stdout.write('{"status":"ERROR","code":"TRANSFER_ARGUMENTS_INVALID"}\n');
    return 2;
  }
  try {
    const report = await transferDatabase({ sourceUrl: source, targetUrl: target, ...(process.env['TRANSFER_PG_BIN'] === undefined ? {} : { pgBin: process.env['TRANSFER_PG_BIN'] }) });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report.status === 'VERIFIED' ? 0 : 1;
  } catch (error) {
    const code = error instanceof Error ? error.message.split(':')[0] ?? 'TRANSFER_FAILED' : 'TRANSFER_FAILED';
    process.stdout.write(`${JSON.stringify({ status: 'ERROR', code })}\n`);
    return 2;
  }
}

if (require.main === module) {
  void main().then((code) => { process.exitCode = code; });
}

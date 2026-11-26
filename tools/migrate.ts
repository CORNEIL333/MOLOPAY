import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { assertSecureDatabaseUrl } from '../apps/api/src/http/database';

/**
 * N1 (ADR-0004 : Neon pour le MVP, transfert vers AWS ensuite) : application
 * des migrations en production, sous le rôle propriétaire (sans
 * superutilisateur sur Neon).
 *
 * - Chaque fichier `NNNN_nom.sql` contient une seule transaction
 *   `BEGIN; … COMMIT;`. L'outil exécute son contenu ET l'inscrit dans
 *   `ops.schema_migration` (nom, SHA-256) dans la même transaction : jamais de
 *   migration appliquée sans trace, ni de trace sans migration.
 * - Une migration déjà appliquée puis modifiée, retirée ou renommée bloque
 *   tout (le schéma réel ne correspondrait plus au dépôt) : on ajoute une
 *   migration, on ne réécrit jamais l'historique.
 * - Verrou consultatif de session : deux exécutions simultanées n'appliquent
 *   rien deux fois.
 * - Base déjà peuplée sans historique : refus (aucune supposition sur son état).
 * Aucune donnée de ligne ni aucun secret n'est affiché.
 */
export type MigrationFile = { readonly version: number; readonly name: string; readonly body: string; readonly sha256: string };
export type MigrationReport = { readonly status: 'UP_TO_DATE' | 'APPLIED' | 'PENDING'; readonly applied: number[]; readonly pending: number[]; readonly current: number };

const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 'molopay.schema-migration';
const DOMAIN_SCHEMAS = ['ledger', 'audit', 'admin', 'identity', 'catalog', 'agreements', 'payments', 'notifications', 'api', 'settlement', 'reconciliation', 'disputes', 'risk', 'kyc', 'crm'];

const pad = (version: number): string => String(version).padStart(4, '0');

/** Corps de la transaction unique du fichier (hors `BEGIN;` et `COMMIT;`), ou null si le format n'est pas respecté. */
function transactionBody(sql: string): string | null {
  const lines = sql.split('\n');
  const code = (line: string): string => line.replace(/--.*$/, '').trim();
  const begins = lines.flatMap((line, index) => (code(line) === 'BEGIN;' ? [index] : []));
  const commits = lines.flatMap((line, index) => (code(line) === 'COMMIT;' ? [index] : []));
  if (begins.length !== 1 || commits.length !== 1) return null;
  const begin = begins[0] ?? -1;
  const commit = commits[0] ?? -1;
  if (commit <= begin) return null;
  const outside = [...lines.slice(0, begin), ...lines.slice(commit + 1)].map(code).filter((line) => line !== '');
  if (outside.length > 0) return null;
  return lines.slice(begin + 1, commit).join('\n');
}

export function readMigrations(directory: string): MigrationFile[] {
  const files: MigrationFile[] = [];
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith('.sql')).sort()) {
    const match = NAME.exec(name);
    if (match === null) throw new Error(`MIGRATION_FORMAT_INVALID: nom de fichier non conforme (${name.replace(/[^A-Za-z0-9_.-]/g, '?')})`);
    const version = Number(match[1]);
    const sql = readFileSync(join(directory, name), 'utf8');
    const body = transactionBody(sql);
    if (body === null) throw new Error(`MIGRATION_FORMAT_INVALID: ${pad(version)} doit contenir une seule transaction BEGIN; … COMMIT;`);
    files.push({ version, name, body, sha256: createHash('sha256').update(sql, 'utf8').digest('hex') });
  }
  files.forEach((file, index) => {
    if (file.version !== index + 1) throw new Error(`MIGRATION_SEQUENCE_GAP: ${pad(index + 1)} attendue, ${pad(file.version)} trouvée`);
  });
  return files;
}

const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS ops;
REVOKE ALL ON SCHEMA ops FROM PUBLIC;
CREATE TABLE IF NOT EXISTS ops.schema_migration (
  version integer PRIMARY KEY CHECK (version >= 1),
  name text NOT NULL UNIQUE CHECK (name ~ '^[0-9]{4}_[a-z0-9_]+\\.sql$'),
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  applied_by text NOT NULL DEFAULT current_user
);
REVOKE ALL ON ops.schema_migration FROM PUBLIC;
CREATE OR REPLACE FUNCTION ops.forbid_schema_migration_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'OPS_APPEND_ONLY: % sur ops.schema_migration refusé', TG_OP;
END $fn$;
CREATE OR REPLACE FUNCTION ops.anchor_schema_migration() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.version <> COALESCE((SELECT max(m.version) FROM ops.schema_migration m), 0) + 1 THEN
    RAISE EXCEPTION 'OPS_MIGRATION_SEQUENCE: version % hors séquence', NEW.version;
  END IF;
  NEW.applied_at := clock_timestamp();
  NEW.applied_by := current_user;
  RETURN NEW;
END $fn$;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'schema_migration_anchor' AND tgrelid = 'ops.schema_migration'::regclass) THEN
    CREATE TRIGGER schema_migration_anchor BEFORE INSERT ON ops.schema_migration FOR EACH ROW EXECUTE FUNCTION ops.anchor_schema_migration();
    CREATE TRIGGER schema_migration_no_update_delete BEFORE UPDATE OR DELETE ON ops.schema_migration FOR EACH ROW EXECUTE FUNCTION ops.forbid_schema_migration_mutation();
    CREATE TRIGGER schema_migration_no_truncate BEFORE TRUNCATE ON ops.schema_migration FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_schema_migration_mutation();
    ALTER TABLE ops.schema_migration ENABLE ALWAYS TRIGGER schema_migration_anchor;
    ALTER TABLE ops.schema_migration ENABLE ALWAYS TRIGGER schema_migration_no_update_delete;
    ALTER TABLE ops.schema_migration ENABLE ALWAYS TRIGGER schema_migration_no_truncate;
  END IF;
END $do$;
`;

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : 'erreur').split('\n')[0]?.slice(0, 300) ?? 'erreur';
}

export async function migrate(input: { readonly url: string; readonly directory: string; readonly dryRun?: boolean }): Promise<MigrationReport> {
  const files = readMigrations(input.directory);
  // N2 : vers Neon, TLS vérifié (verify-full) avant toute connexion.
  assertSecureDatabaseUrl(input.url, process.env);
  const client = new Client({ connectionString: input.url });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [LOCK_KEY]);
    const known = (await client.query<{ present: boolean }>(`SELECT to_regclass('ops.schema_migration') IS NOT NULL AS present`)).rows[0]?.present === true;
    const recorded = known
      ? (await client.query<{ version: number; name: string; sha256: string }>(`SELECT version, name, encode(sha256, 'hex') AS sha256 FROM ops.schema_migration ORDER BY version`)).rows
      : [];
    if (recorded.length === 0) {
      const populated = (await client.query<{ n: number }>('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = ANY($1::text[])', [DOMAIN_SCHEMAS])).rows[0]?.n ?? 0;
      if (populated > 0) throw new Error('MIGRATION_BASELINE_REQUIRED: base déjà peuplée sans historique de migrations ; aucune supposition sur son état');
    }
    for (const row of recorded) {
      const file = files[row.version - 1];
      if (file === undefined || file.name !== row.name) throw new Error(`MIGRATION_UNKNOWN_APPLIED: ${pad(row.version)} appliquée mais absente ou renommée dans le dépôt`);
      if (file.sha256 !== row.sha256) throw new Error(`MIGRATION_CHECKSUM_MISMATCH: ${pad(row.version)} modifiée après son application ; ajouter une nouvelle migration`);
    }
    const pending = files.slice(recorded.length);
    if (input.dryRun === true) {
      return { status: pending.length === 0 ? 'UP_TO_DATE' : 'PENDING', applied: [], pending: pending.map((file) => file.version), current: recorded.length };
    }
    if (!known) await client.query(`BEGIN;\n${BOOTSTRAP}\nCOMMIT;`);
    const applied: number[] = [];
    for (const file of pending) {
      // Nom et empreinte validés par motif (aucune valeur libre dans la requête).
      if (!NAME.test(file.name) || !/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error('MIGRATION_FORMAT_INVALID');
      try {
        await client.query(`BEGIN;\n${file.body}\n;\nINSERT INTO ops.schema_migration (version, name, sha256) VALUES (${file.version}, '${file.name}', decode('${file.sha256}', 'hex'));\nCOMMIT;`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`MIGRATION_FAILED: ${pad(file.version)} annulée (${firstLine(error)})`, { cause: error });
      }
      applied.push(file.version);
    }
    return { status: applied.length === 0 ? 'UP_TO_DATE' : 'APPLIED', applied, pending: [], current: recorded.length + applied.length };
  } finally {
    await client.query('SELECT pg_advisory_unlock_all()').catch(() => undefined);
    await client.end();
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const url = process.env['MIGRATION_DATABASE_URL']?.trim() ?? '';
  const args = argv.filter((arg) => arg !== '--');
  if (url === '' || args.some((arg) => arg !== '--dry-run')) {
    process.stdout.write('{"status":"ERROR","code":"MIGRATION_ARGUMENTS_INVALID"}\n');
    return 2;
  }
  try {
    const report = await migrate({ url, directory: resolve(process.cwd(), 'db/migrations'), dryRun: args.includes('--dry-run') });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return 0;
  } catch (error) {
    const message = firstLine(error);
    process.stdout.write(`${JSON.stringify({ status: 'ERROR', code: message.split(':')[0] ?? 'MIGRATION_FAILED', detail: message })}\n`);
    return 1;
  }
}

if (require.main === module) {
  void main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

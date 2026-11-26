import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { withTransaction, type Database } from './database';

/**
 * N1 / N6 : lecture des migrations du dépôt (format, numérotation,
 * empreintes) — partagée par l'outil de migration et par le contrôle de
 * démarrage de l'API.
 */
export type MigrationFile = { readonly version: number; readonly name: string; readonly body: string; readonly sha256: string };

const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

export const padVersion = (version: number): string => String(version).padStart(4, '0');

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
    if (body === null) throw new Error(`MIGRATION_FORMAT_INVALID: ${padVersion(version)} doit contenir une seule transaction BEGIN; … COMMIT;`);
    files.push({ version, name, body, sha256: createHash('sha256').update(sql, 'utf8').digest('hex') });
  }
  files.forEach((file, index) => {
    if (file.version !== index + 1) throw new Error(`MIGRATION_SEQUENCE_GAP: ${padVersion(index + 1)} attendue, ${padVersion(file.version)} trouvée`);
  });
  return files;
}


type Queryable = Pick<PoolClient, 'query'>;

/**
 * N6 (AGENTS.md § 0.7) : l'historique `ops.schema_migration` de la base doit
 * être exactement celui des migrations livrées avec le code (même nombre,
 * mêmes noms, mêmes empreintes). Sinon : `SCHEMA_VERSION_MISMATCH`, l'API ne
 * démarre pas. Lecture seule (rôle `app_ro`).
 */
export async function assertSchemaCurrent(client: Queryable, files: readonly MigrationFile[]): Promise<{ readonly version: number }> {
  let rows: { version: number; name: string; sha256: string }[];
  try {
    rows = (await client.query<{ version: number; name: string; sha256: string }>(`SELECT version, name, encode(sha256, 'hex') AS sha256 FROM ops.schema_migration ORDER BY version`)).rows;
  } catch (error) {
    throw new Error('SCHEMA_VERSION_MISMATCH: historique des migrations absent ou illisible', { cause: error });
  }
  if (rows.length !== files.length) {
    throw new Error(`SCHEMA_VERSION_MISMATCH: base en version ${rows.length}, code en version ${files.length}`);
  }
  rows.forEach((row, index) => {
    const file = files[index];
    if (file === undefined || row.version !== file.version || row.name !== file.name || row.sha256 !== file.sha256) {
      throw new Error(`SCHEMA_VERSION_MISMATCH: ${padVersion(index + 1)} diffère entre la base et le code`);
    }
  });
  return { version: files.length };
}

/**
 * N6 : contrôle de démarrage de l'API. En production seulement (les bases de
 * développement et de test n'ont pas forcément d'historique) : lit
 * l'historique avec le rôle `app_ro` et le compare aux migrations livrées
 * (`MIGRATIONS_DIR`, par défaut `db/migrations`). Hors production : `null`.
 */
export async function verifySchemaAtStartup(database: Database, env: NodeJS.ProcessEnv): Promise<{ readonly version: number } | null> {
  if (env['NODE_ENV'] !== 'production') return null;
  let files: MigrationFile[];
  try {
    files = readMigrations(resolve(env['MIGRATIONS_DIR']?.trim() || 'db/migrations'));
  } catch (error) {
    throw new Error('SCHEMA_MANIFEST_MISSING: migrations livrées introuvables ou illisibles', { cause: error });
  }
  return withTransaction({ ...database, role: 'app_ro' }, (client) => assertSchemaCurrent(client, files), { readOnlySnapshot: true });
}

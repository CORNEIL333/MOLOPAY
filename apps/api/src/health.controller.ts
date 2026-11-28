import { resolve } from 'node:path';
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { PG_POOL, withTransaction, type Database } from './http/database';
import { assertSchemaCurrent, readMigrations, type MigrationFile } from './http/migration-manifest';

/** Au-delà, la sonde de disponibilité échoue au lieu d'attendre indéfiniment. */
export const READINESS_TIMEOUT_MS = 2_000;

function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('READINESS_TIMEOUT')), milliseconds);
  });
  return Promise.race([operation, expiry]).finally(() => clearTimeout(timer));
}

let manifest: readonly MigrationFile[] | null | undefined;

/**
 * Migrations livrées avec le code, lues une fois. `null` si le manifeste est
 * illisible : la disponibilité échoue alors (503), comme pour un schéma
 * différent — une base dont on ne peut pas prouver la version n'est pas prête.
 */
export function schemaManifest(): readonly MigrationFile[] | null {
  if (manifest === undefined) {
    try {
      manifest = readMigrations(resolve(process.env['MIGRATIONS_DIR']?.trim() || 'db/migrations'));
    } catch {
      manifest = null;
    }
  }
  return manifest;
}

/**
 * Vivacité : le processus répond, sans dépendre de la base (un redémarrage ne
 * répare pas une base indisponible). Disponibilité : la base répond, et son
 * historique `ops.schema_migration` est exactement celui du code livré (même
 * nombre, mêmes noms, mêmes empreintes), lu sous le rôle `app_ro`. Le détail
 * de l'échec n'est jamais exposé (NF-REL-001).
 */
@Controller('health')
export class HealthController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Get()
  public health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  public async ready(): Promise<{ status: 'ready' }> {
    try {
      await withTimeout(this.check(), READINESS_TIMEOUT_MS);
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException();
    }
  }

  private async check(): Promise<void> {
    const files = schemaManifest();
    if (files === null) throw new Error('SCHEMA_MANIFEST_MISSING');
    // Lecture seule, rôle app_ro : c'est le seul compte autorisé à lire
    // l'historique des migrations, jamais le rôle d'écriture de l'API.
    await withTransaction(
      { ...this.database, role: 'app_ro' },
      async (client) => {
        await client.query('SELECT 1');
        await assertSchemaCurrent(client, files);
      },
      { readOnlySnapshot: true },
    );
  }
}
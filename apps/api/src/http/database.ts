import { Pool, type PoolClient } from 'pg';

/** Jeton d'injection du pool PostgreSQL (injection explicite, sans métadonnées). */
export const PG_POOL = Symbol('PG_POOL');

const ALLOWED_ROLES = new Set(['app_rw', 'app_ro']);

export type DatabaseConfig = {
  readonly connectionString: string;
  /** Rôle pris dans chaque transaction (moindre privilège), si défini. */
  readonly role: 'app_rw' | 'app_ro' | null;
};

/**
 * Lit la configuration dans l'environnement. Aucune valeur par défaut : sans
 * DATABASE_URL, l'API refuse de démarrer. Aucun secret n'est journalisé.
 */
export function databaseConfigFromEnv(env: NodeJS.ProcessEnv): DatabaseConfig {
  const connectionString = env['DATABASE_URL']?.trim() ?? '';
  if (connectionString === '') {
    throw new Error('CONFIG_MISSING: DATABASE_URL');
  }
  const role = env['DATABASE_ROLE']?.trim() ?? '';
  if (role !== '' && !ALLOWED_ROLES.has(role)) {
    throw new Error('CONFIG_INVALID: DATABASE_ROLE doit valoir app_rw ou app_ro');
  }
  return {
    connectionString,
    role: role === '' ? null : (role as 'app_rw' | 'app_ro'),
  };
}

export type Database = {
  readonly pool: Pool;
  readonly role: DatabaseConfig['role'];
};

export function createDatabase(config: DatabaseConfig): Database {
  return { pool: new Pool({ connectionString: config.connectionString, max: 10 }), role: config.role };
}

/**
 * Exécute `action` dans une transaction ; tout échec annule l'ensemble. Le
 * rôle configuré est pris localement à la transaction.
 */
export async function withTransaction<T>(
  database: Database,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    if (database.role !== null) {
      // Valeur issue d'une liste blanche, jamais d'une entrée utilisateur.
      await client.query(`SET LOCAL ROLE ${database.role}`);
    }
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

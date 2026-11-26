import { Pool, type PoolClient } from 'pg';

/** Jeton d'injection du pool PostgreSQL (injection explicite, sans métadonnées). */
export const PG_POOL = Symbol('PG_POOL');

const ALLOWED_ROLES = new Set(['app_rw', 'app_ro']);

export type DatabaseConfig = {
  readonly connectionString: string;
  /** Rôle pris dans chaque transaction (moindre privilège), si défini. */
  readonly role: 'app_rw' | 'app_ro' | null;
};

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
/** Paramètres TLS qui modifieraient la vérification par défaut de node-postgres en verify-full. */
const TLS_OVERRIDES = ['sslrootcert', 'sslcert', 'sslkey', 'sslaccept', 'uselibpqcompat', 'rejectunauthorized', 'ssl', 'sslnegotiation'];

/**
 * N2 (ADR-0004, SEC-CRY-001) : vers une base distante (Neon), et en
 * production pour toute base, la connexion exige `sslmode=verify-full` :
 * chiffrement et vérification du certificat, nom d'hôte compris, avec les
 * autorités du système. Tout réglage TLS supplémentaire est refusé. Le
 * message d'erreur ne recopie jamais l'adresse (elle peut contenir un mot de
 * passe ou un nom d'hôte interne).
 */
export function assertSecureDatabaseUrl(raw: string, env: NodeJS.ProcessEnv): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL_INVALID: adresse de base illisible');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL_INVALID: protocole PostgreSQL attendu');
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (local && env['NODE_ENV'] !== 'production') return;
  const modes = url.searchParams.getAll('sslmode');
  const overrides = [...url.searchParams.keys()].filter((key) => TLS_OVERRIDES.includes(key.toLowerCase()));
  if (modes.length !== 1 || modes[0] !== 'verify-full' || overrides.length > 0) {
    throw new Error('DATABASE_TLS_REQUIRED: sslmode=verify-full exigé (base distante ou production), sans autre réglage TLS');
  }
}

/**
 * Lit la configuration dans l'environnement. Aucune valeur par défaut : sans
 * DATABASE_URL, l'API refuse de démarrer. Aucun secret n'est journalisé.
 */
export function databaseConfigFromEnv(env: NodeJS.ProcessEnv): DatabaseConfig {
  const connectionString = env['DATABASE_URL']?.trim() ?? '';
  if (connectionString === '') {
    throw new Error('CONFIG_MISSING: DATABASE_URL');
  }
  assertSecureDatabaseUrl(connectionString, env);
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
  options: { readonly readOnlySnapshot?: boolean } = {},
): Promise<T> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    if (options.readOnlySnapshot === true) {
      // Lecture pure : toutes les requêtes voient le même instantané (en READ
      // COMMITTED, chaque requête prend le sien) et aucune écriture n'est possible.
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    }
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

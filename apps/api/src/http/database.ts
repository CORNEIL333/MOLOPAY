import { Pool, type PoolClient } from 'pg';

/** Jeton d'injection du pool PostgreSQL (injection explicite, sans métadonnées). */
export const PG_POOL = Symbol('PG_POOL');

const ALLOWED_ROLES = new Set(['app_rw', 'app_ro']);

export type DatabaseConfig = {
  readonly connectionString: string;
  /** Rôle pris dans chaque transaction (moindre privilège), si défini. */
  readonly role: 'app_rw' | 'app_ro' | null;
  /** Taille maximale du pool (Neon : nombre de connexions limité par la taille du calcul). */
  readonly poolMax?: number;
  /** Durée maximale d'une requête, posée par `SET LOCAL` dans chaque transaction. */
  readonly statementTimeoutMs?: number;
  /** N8 : connexion inactive coupée par la base (code seul) ; par défaut, une ligne JSON sur la sortie d'erreur. */
  readonly onConnectionLost?: (code: string) => void;
};

/** Code d'une erreur de connexion, sans message (qui pourrait contenir une adresse). */
export function connectionErrorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^([0-9A-Z]{5}|E[A-Z_]{2,30})$/.test(code) ? code : 'CONNECTION_LOST';
}

export function reportConnectionLost(code: string): void {
  process.stderr.write(`${JSON.stringify({ event: 'DATABASE_CONNECTION_LOST', code })}\n`);
}

const DEFAULT_POOL_MAX = 10;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

function boundedInteger(env: NodeJS.ProcessEnv, name: string, min: number, max: number, fallback: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (!/^[0-9]+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    throw new Error(`CONFIG_INVALID: ${name} doit être un entier de ${min} à ${max}`);
  }
  return Number(raw);
}

/**
 * Neon : le point d'accès groupé (`-pooler`) ne garantit pas les fonctions de
 * session (verrou consultatif de session, paramètre de démarrage \`options\`).
 * Les outils qui en dépendent (migration, sauvegarde, transfert, contrôle
 * nocturne, supervision) exigent le point d'accès direct. L'API, qui ne pose
 * que des réglages locaux à la transaction, peut utiliser l'un ou l'autre.
 */
export function assertDirectEndpoint(raw: string): void {
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error('DATABASE_URL_INVALID: adresse de base illisible');
  }
  if (/-pooler\./.test(host)) throw new Error('DATABASE_POOLER_FORBIDDEN: point d’accès direct exigé (sans -pooler)');
}

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
    poolMax: boundedInteger(env, 'DATABASE_POOL_MAX', 1, 50, DEFAULT_POOL_MAX),
    statementTimeoutMs: boundedInteger(env, 'DATABASE_STATEMENT_TIMEOUT_MS', 1000, 120_000, DEFAULT_STATEMENT_TIMEOUT_MS),
  };
}

export type Database = {
  readonly pool: Pool;
  readonly role: DatabaseConfig['role'];
  readonly statementTimeoutMs?: number;
};

export function createDatabase(config: DatabaseConfig): Database {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.poolMax ?? DEFAULT_POOL_MAX,
    // Base injoignable : échec rapide plutôt qu'attente indéfinie ; connexions inactives rendues.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    // N8 : coupure silencieuse d'un lien réseau inactif détectée par le système.
    keepAlive: true,
  });
  // N8 : Neon coupe les connexions au redémarrage du calcul. Sans écouteur, l'erreur d'une
  // connexion inactive ferait tomber le processus ; le pool l'écarte et en ouvre une neuve.
  const lost = config.onConnectionLost ?? reportConnectionLost;
  pool.on('error', (error) => lost(connectionErrorCode(error)));
  return { pool, role: config.role, statementTimeoutMs: config.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS };
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
  // N8 : une connexion prise est écoutée par l'appelant, pas par le pool. Sans écouteur, sa
  // coupure (Neon) ferait tomber le processus ; la requête en cours échoue de toute façon, et
  // le pool n'y remet jamais une connexion devenue inutilisable.
  const onError = (): void => undefined;
  client.on('error', onError);
  try {
    await client.query('BEGIN');
    if (options.readOnlySnapshot === true) {
      // Lecture pure : toutes les requêtes voient le même instantané (en READ
      // COMMITTED, chaque requête prend le sien) et aucune écriture n'est possible.
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    }
    // Durée maximale par requête, locale à la transaction (compatible avec le regroupeur de Neon).
    const timeout = database.statementTimeoutMs;
    if (timeout !== undefined && Number.isInteger(timeout) && timeout > 0) {
      await client.query(`SET LOCAL statement_timeout = ${timeout}`);
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
    client.removeListener('error', onError);
    client.release();
  }
}

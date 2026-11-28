import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

const POSTGRES_IMAGE =
  'postgres:16.15-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab';

export type TestDatabase = {
  getConnectionUri(): string;
  stop(): Promise<void>;
};

function assertDisposableUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('TEST_DB_URL_INVALID: DATABASE_URL n’est pas une URL valide');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('TEST_DB_URL_INVALID: DATABASE_URL doit être PostgreSQL');
  }
  const host = url.hostname;
  const local =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]';
  // Les suites retirent les schémas : une base distante n'est acceptée que
  // si l'opérateur confirme qu'elle est jetable.
  if (!local && process.env['ALLOW_REMOTE_TEST_DB'] !== '1') {
    throw new Error(
      'TEST_DB_REMOTE_FORBIDDEN: base non locale ; définir ALLOW_REMOTE_TEST_DB=1 ' +
        'uniquement pour une base jetable',
    );
  }
  return raw;
}

/**
 * Base des tests d'intégration : DATABASE_URL si fourni, sinon Testcontainers.
 * Dans les deux cas, les tests détruisent les schémas du domaine concerné.
 */
export async function startTestDatabase(options?: {
  readonly database?: string;
}): Promise<TestDatabase> {
  const configured = process.env['DATABASE_URL']?.trim();
  if (configured !== undefined && configured !== '') {
    const connectionString = assertDisposableUrl(configured);
    return {
      getConnectionUri: () => connectionString,
      stop: () => Promise.resolve(),
    };
  }
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    POSTGRES_IMAGE,
  )
    .withDatabase(options?.database ?? 'achat_test')
    .withStartupTimeout(120_000)
    .start();
  return {
    getConnectionUri: () => container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}

import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { type INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module';
import { HealthController, READINESS_TIMEOUT_MS } from './health.controller';
import type { Database } from './http/database';
import { readMigrations } from './http/migration-manifest';

const ORIGIN = 'http://localhost:3000';
const FILES = readMigrations(resolve(process.cwd(), 'db/migrations'));
const HISTORY = FILES.map((file) => ({ version: file.version, name: file.name, sha256: file.sha256 }));

type HistoryRow = { version: number; name: string; sha256: string };

type Fake = {
  database: Database;
  connect: ReturnType<typeof vi.fn>;
  queries: string[];
  release: ReturnType<typeof vi.fn>;
};

/**
 * Faux pool : la disponibilité ouvre une transaction (`connect` + BEGIN/SET),
 * lit `SELECT 1` puis l'historique des migrations. Chaque cas ne remplace que
 * la partie qui l'intéresse.
 */
function databaseWith(options: {
  readonly select1?: () => Promise<unknown>;
  readonly history?: () => Promise<{ rows: HistoryRow[] }>;
} = {}): Fake {
  const queries: string[] = [];
  const release = vi.fn();
  const clientQuery = vi.fn(async (sql: string) => {
    queries.push(sql);
    if (sql === 'SELECT 1') return options.select1 === undefined ? { rows: [{ '?column?': 1 }] } : options.select1();
    if (sql.includes('ops.schema_migration')) {
      return options.history === undefined ? { rows: HISTORY } : options.history();
    }
    return { rows: [] };
  });
  const connect = vi.fn(() => Promise.resolve({ query: clientQuery, release }));
  return {
    database: { pool: { connect } as unknown as Database['pool'], role: null },
    connect,
    queries,
    release,
  };
}

async function application(database: Database): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ database, allowedOrigins: new Set([ORIGIN]) })],
  }).compile();
  return moduleRef.createNestApplication({ logger: false });
}

function server(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('NF-REL-001 · santé et disponibilité', () => {
  it('la vivacité répond sans interroger la base', async () => {
    const fake = databaseWith();
    const app = await application(fake.database);
    await app.init();
    const response = await request(server(app)).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(fake.connect).not.toHaveBeenCalled();
    await app.close();
  });

  it('la disponibilité sonde la base, lit l’historique sous app_ro et répond 200', async () => {
    const fake = databaseWith();
    const app = await application(fake.database);
    await app.init();
    const response = await request(server(app)).get('/health/ready').expect(200);
    expect(response.body).toEqual({ status: 'ready' });
    expect(fake.queries[0]).toBe('BEGIN');
    expect(fake.queries).toContain('SET LOCAL ROLE app_ro');
    expect(fake.queries).toContain('SELECT 1');
    expect(fake.queries.some((sql) => sql.includes('ops.schema_migration'))).toBe(true);
    expect(fake.queries.at(-1)).toBe('COMMIT');
    expect(fake.release).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('la disponibilité répond 503 en problème RFC 9457 sans détail quand la base échoue', async () => {
    const fake = databaseWith({ select1: () => Promise.reject(new Error('connexion refusée : 10.0.0.1')) });
    const app = await application(fake.database);
    await app.init();
    const response = await request(server(app)).get('/health/ready').expect(503);
    const body = response.body as Record<string, unknown>;
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(body).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(body['detail']).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('10.0.0.1');
    expect(fake.queries).toContain('ROLLBACK');
    await app.close();
  });

  it.each([
    ['historique absent ou illisible', () => Promise.reject(new Error('relation "ops.schema_migration" n’existe pas'))],
    ['une migration manque', () => Promise.resolve({ rows: HISTORY.slice(0, -1) })],
    ['une migration est plus récente que le code', () => Promise.resolve({ rows: [...HISTORY, { version: FILES.length + 1, name: '9999_future.sql', sha256: '0'.repeat(64) }] })],
    ['l’empreinte d’une migration diffère', () => Promise.resolve({ rows: HISTORY.map((row, index) => (index === 0 ? { ...row, sha256: 'f'.repeat(64) } : row)) })],
    ['le nom d’une migration diffère', () => Promise.resolve({ rows: HISTORY.map((row, index) => (index === 0 ? { ...row, name: '0001_autre.sql' } : row)) })],
  ])('la disponibilité répond 503 quand %s (schéma différent du code)', async (_label, history) => {
    const fake = databaseWith({ history });
    const app = await application(fake.database);
    await app.init();
    const response = await request(server(app)).get('/health/ready').expect(503);
    expect(response.body).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect((response.body as Record<string, unknown>)['detail']).toBeUndefined();
    await app.close();
  });

  it('la disponibilité répond 503 quand la base ne répond pas dans le délai', async () => {
    vi.useFakeTimers();
    const controller = new HealthController(databaseWith({ select1: () => new Promise(() => undefined) }).database);
    const pending = controller.ready();
    const assertion = expect(pending).rejects.toBeInstanceOf(ServiceUnavailableException);
    await vi.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('la disponibilité efface son minuteur quand la base répond', async () => {
    vi.useFakeTimers();
    const controller = new HealthController(databaseWith().database);
    await expect(controller.ready()).resolves.toEqual({ status: 'ready' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
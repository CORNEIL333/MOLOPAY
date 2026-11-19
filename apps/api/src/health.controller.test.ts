import type { Server } from 'node:http';
import { type INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module';
import { HealthController, READINESS_TIMEOUT_MS } from './health.controller';
import type { Database } from './http/database';

const ORIGIN = 'http://localhost:3000';

function databaseWith(query: () => Promise<unknown>): { database: Database; query: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(query);
  return {
    database: { pool: { query: spy } as unknown as Database['pool'], role: null },
    query: spy,
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
    const { database, query } = databaseWith(() => Promise.resolve({ rows: [{ '?column?': 1 }] }));
    const app = await application(database);
    await app.init();
    const response = await request(server(app)).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });

  it('la disponibilité sonde la base et répond 200 quand elle répond', async () => {
    const { database, query } = databaseWith(() => Promise.resolve({ rows: [{ '?column?': 1 }] }));
    const app = await application(database);
    await app.init();
    const response = await request(server(app)).get('/health/ready').expect(200);
    expect(response.body).toEqual({ status: 'ready' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('SELECT 1');
    await app.close();
  });

  it('la disponibilité répond 503 en problème RFC 9457 sans détail quand la base échoue', async () => {
    const { database } = databaseWith(() => Promise.reject(new Error('connexion refusée : 10.0.0.1')));
    const app = await application(database);
    await app.init();
    const response = await request(server(app)).get('/health/ready').expect(503);
    const body = response.body as Record<string, unknown>;
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(body).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(body['detail']).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('10.0.0.1');
    await app.close();
  });

  it('la disponibilité répond 503 quand la base ne répond pas dans le délai', async () => {
    vi.useFakeTimers();
    const controller = new HealthController(databaseWith(() => new Promise(() => undefined)).database);
    const pending = controller.ready();
    const assertion = expect(pending).rejects.toBeInstanceOf(ServiceUnavailableException);
    await vi.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('la disponibilité efface son minuteur quand la base répond', async () => {
    vi.useFakeTimers();
    const controller = new HealthController(databaseWith(() => Promise.resolve({ rows: [] })).database);
    await expect(controller.ready()).resolves.toEqual({ status: 'ready' });
    expect(vi.getTimerCount()).toBe(0);
  });
});

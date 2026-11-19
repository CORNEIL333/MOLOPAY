import 'reflect-metadata';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import type { LogSink } from './log';
import { CORRELATION_HEADER, correlationIdFromHeader } from './correlation';

const GENERATED = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('NF-OBS-001 · identifiant de corrélation', () => {
  it('NF-OBS-001 reprend un identifiant client conforme', () => {
    expect(correlationIdFromHeader('trace-12345678')).toBe('trace-12345678');
  });

  it.each(['', 'court', 'avec espace', 'a'.repeat(65), 'ligne\ninjectée', 'a\r\nb', 'é-accent'])(
    'NF-OBS-001 remplace un identifiant non conforme %j par un UUID',
    (value) => {
      const id = correlationIdFromHeader(value);
      expect(id).toMatch(GENERATED);
      expect(id).not.toBe(value);
    },
  );

  it('NF-OBS-001 génère un identifiant en l’absence d’en-tête', () => {
    expect(correlationIdFromHeader(undefined)).toMatch(GENERATED);
  });
});

describe('NF-OBS-001 · corrélation et journal de bout en bout (HTTP réel)', () => {
  let app: INestApplication;
  const lines: string[] = [];
  const sink: LogSink = { write: (line) => { lines.push(line); } };
  function server(): Server { return app.getHttpServer() as Server; }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register({ database: {} as never, allowedOrigins: new Set(), logSink: sink })],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => { await app.close(); });

  it('NF-OBS-001 renvoie l’en-tête et journalise la requête avec la corrélation fournie', async () => {
    lines.length = 0;
    const response = await request(server())
      .get('/health')
      .set(CORRELATION_HEADER, 'trace-12345678');
    expect(response.status).toBe(200);
    expect(response.headers[CORRELATION_HEADER]).toBe('trace-12345678');
    await vi.waitFor(() => {
      const record = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((entry) => entry['event'] === 'http_request' && entry['correlationId'] === 'trace-12345678');
      expect(record).toMatchObject({ method: 'GET', path: '/health', status: 200 });
    });
  });

  it('NF-OBS-001 génère et renvoie une corrélation quand l’en-tête est absent', async () => {
    lines.length = 0;
    const response = await request(server()).get('/health');
    const header = response.headers[CORRELATION_HEADER];
    expect(header).toMatch(GENERATED);
    await vi.waitFor(() => {
      expect(lines.some((line) => line.includes(`"correlationId":"${String(header)}"`))).toBe(true);
    });
  });

  it('NF-OBS-001 ignore un en-tête non conforme et n’écrit pas de donnée d’en-tête', async () => {
    lines.length = 0;
    const response = await request(server())
      .get('/health')
      .set(CORRELATION_HEADER, 'trace invalide');
    const header = response.headers[CORRELATION_HEADER];
    expect(header).toMatch(GENERATED);
    expect(header).not.toBe('trace invalide');
    await vi.waitFor(() => {
      expect(lines.length).toBeGreaterThan(0);
    });
    expect(lines.join('\n')).not.toContain('trace invalide');
  });

  it('NF-OBS-001 ne journalise ni jeton ni mot de passe du chemin', async () => {
    lines.length = 0;
    await request(server()).get('/health?token=secret-de-test');
    await vi.waitFor(() => {
      expect(lines.length).toBeGreaterThan(0);
    });
    expect(lines.join('\n')).not.toContain('secret-de-test');
  });
});

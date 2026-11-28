import type { Server } from 'node:http';
import { type INestApplication, Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import type { Database } from '../http/database';
import { type LogSink } from './log';

/**
 * S6 : un journal ne doit contenir ni PIN, ni OTP, ni numéro en clair, ni
 * pièce d'identité, ni adresse de base avec mot de passe, ni valeur de
 * `*_PEPPER`, ni clé KMS. Le contrôle passe par le vrai chemin HTTP (middleware
 * de corrélation + filtre RFC 9457) avec des valeurs hostiles : tout ce qui
 * sort du journal est relu ici.
 */
const ORIGIN = 'http://localhost:3000';

/** Valeurs qui ne doivent jamais apparaître dans une ligne de journal. */
const SECRETS = [
  'postgres://molopay:motdepasse@database:5432/molopay',
  'motdepasse',
  '48151623', // PIN
  '654321', // OTP
  '612340001', // numéro de téléphone complet
  'CNI-998877', // pièce d'identité
  'pepper-value-0123456789abcdef', // valeur de *_PEPPER
  'arn:aws:kms:eu-west-3:123456789012:key/abcd', // clé KMS
];

const HOSTILE_MESSAGE = [
  'connexion ' + SECRETS[0],
  'pin=' + SECRETS[3], // 48151623
  'otp=' + SECRETS[4],
  'tel=+237 ' + SECRETS[5],
  'piece=' + SECRETS[6],
  'pepper=' + SECRETS[7],
  'kms=' + SECRETS[8],
].join(' ');

@Controller('privacy')
class HostileController {
  @Get('boom')
  public boom(): never {
    throw new Error(HOSTILE_MESSAGE);
  }
}

type TestSink = LogSink & { lines: string[] };

function application(sink: TestSink): Promise<INestApplication> {
  const database = { pool: {} as Database['pool'], role: null } satisfies Database;
  const moduleRef = Test.createTestingModule({
    imports: [
      AppModule.register({
        database,
        allowedOrigins: new Set([ORIGIN]),
        logSink: sink,
        extraControllers: [HostileController],
      }),
    ],
  }).compile();
  return moduleRef.then((module) => module.createNestApplication({ logger: false }));
}

function lines(sink: TestSink): Record<string, unknown>[] {
  return sink.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('S6 · aucun secret ni donnée personnelle dans les journaux', () => {
  it('un 500 hostile ne recopie ni message, ni DSN, ni PIN/OTP, ni téléphone, ni pièce, ni poivre, ni clé KMS', async () => {
    const sink = { lines: [] as string[], write(line: string): void { this.lines.push(line); } };
    const app = await application(sink);
    await app.init();
    const response = await request(app.getHttpServer() as Server)
      .get('/privacy/boom?tel=+237612340001&otp=654321')
      .set('x-correlation-id', 'postgres://molopay:motdepasse@database')
      .set('accept-language', 'fr')
      .expect(500);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const body = JSON.stringify(response.body);
    expect(response.body).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect((response.body as Record<string, unknown>)['detail']).toBeUndefined();
    for (const secret of SECRETS) {
      expect(body, secret).not.toContain(secret);
    }

    const written = sink.lines;
    expect(written.length).toBeGreaterThanOrEqual(2); // requête + erreur
    for (const line of written) {
      for (const secret of SECRETS) {
        expect(line, secret).not.toContain(secret);
      }
    }

    const request_line = lines(sink).find((entry) => entry['event'] === 'http_request');
    expect(request_line).toMatchObject({ level: 'info', path: '/[redacted]' });
    const error_line = lines(sink).find((entry) => entry['event'] === 'http_error');
    expect(error_line).toMatchObject({ level: 'error', code: 'INTERNAL_ERROR', errorName: 'Error' });
    const ALLOWED = new Set(['time', 'level', 'event', 'correlationId', 'method', 'path', 'status', 'durationMs', 'code', 'errorName', 'phone']);
    expect(Object.keys(error_line ?? {}).filter((key) => !ALLOWED.has(key))).toEqual([]);
    await app.close();
  });

  it('un identifiant de corrélation forgé (adresse de base) est remplacé, jamais recopié', async () => {
    const sink = { lines: [] as string[], write(line: string): void { this.lines.push(line); } };
    const app = await application(sink);
    await app.init();
    const response = await request(app.getHttpServer() as Server)
      .get('/health')
      .set('x-correlation-id', 'postgres://molopay:motdepasse@database:5432/molopay')
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const correlation = response.headers['x-correlation-id'] ?? '';
    expect(correlation).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const written = sink.lines.join('\n');
    expect(written).not.toContain('motdepasse');
    expect(written).toContain(correlation);
    await app.close();
  });
});
import 'reflect-metadata';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { createDatabase, type Database } from '../../src/http/database';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * Lot 24 / SEC-API-001 : toute route d'écriture déclarée par l'application
 * refuse une requête sans Origin autorisée (403 ORIGIN_FORBIDDEN), avant tout
 * traitement. La liste est lue dans les métadonnées : une route ajoutée plus
 * tard est couverte d'office.
 */
const ORIGIN = 'https://app.example.test';
const SAMPLE_ID = '019aa300-0000-7000-8000-000000000001';
const REQUEST_METHOD_POST = 1;

let db: TestDatabase;
let database: Database;
let app: INestApplication;

function postRoutes(): string[] {
  const controllers = AppModule.register({ database, allowedOrigins: new Set([ORIGIN]) }).controllers ?? [];
  const paths: string[] = [];
  for (const controller of controllers) {
    const base = (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ?? '';
    const prototype = controller.prototype as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[key];
      if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) !== REQUEST_METHOD_POST) {
        continue;
      }
      const path = (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? '';
      const joined = `/${[base, path].filter((part) => part !== '' && part !== '/').join('/')}`.replace(/\/+/g, '/');
      paths.push(joined.replace(/:[A-Za-z]+/g, SAMPLE_ID));
    }
  }
  return paths;
}

beforeAll(async () => {
  db = await startTestDatabase();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ database, allowedOrigins: new Set([ORIGIN]) })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
}, 120_000);

afterAll(async () => {
  await app.close();
  await database.pool.end();
  await db.stop();
});

describe('Lot 24 / SEC-API-001 garde Origin sur toutes les routes d’écriture', () => {
  it('l’application déclare des routes POST (le test porte sur quelque chose)', () => {
    expect(postRoutes().length).toBeGreaterThan(8);
  });

  it('sans Origin ou avec une Origin étrangère : 403 ORIGIN_FORBIDDEN sur chaque route POST', async () => {
    const server = app.getHttpServer() as Server;
    const failures: string[] = [];
    for (const path of postRoutes()) {
      for (const origin of [undefined, 'https://attaquant.example']) {
        const call = request(server).post(path).set('Idempotency-Key', 'origin-check-0001').send({});
        const response = await (origin === undefined ? call : call.set('Origin', origin));
        const code = (response.body as { code?: string }).code;
        if (response.status !== 403 || code !== 'ORIGIN_FORBIDDEN') {
          failures.push(`${path} (${origin ?? 'sans Origin'}) → ${response.status} ${code ?? ''}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

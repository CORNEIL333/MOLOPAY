import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createDatabase, type Database } from '../src/http/database';

describe('API health (e2e)', () => {
  let app: INestApplication;
  // /health ne touche pas la base : le pool n'ouvre aucune connexion.
  const database: Database = createDatabase({
    connectionString: 'postgres://localhost:1/inutilise',
    role: null,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register({ database, allowedOrigins: new Set() })],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await database.pool.end();
  });

  it('GET /health répond 200 avec le schéma du contrat', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/health')
      .expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

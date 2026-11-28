import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, withTransaction, type Database } from '../../src/http/database';
import { committed } from '../../src/modules/notifications/dispatch.store';
import { createNotifierPool } from '../../../../tools/notify-worker';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * N8 (Neon, ADR-0004) : Neon coupe les connexions lors d'un redémarrage ou
 * d'une mise à jour du calcul. Une connexion inactive coupée ne doit pas faire
 * tomber le processus (erreur du pool non écoutée), et une connexion coupée en
 * pleine transaction ne doit jamais être rendue au pool : la requête suivante
 * repart sur une connexion neuve. Vérifié sur PostgreSQL réel par
 * pg_terminate_backend (même code 57P01 qu'un arrêt administratif).
 */
let db: TestDatabase;
let admin: Client;

async function pidOf(database: Database): Promise<number> {
  return withTransaction(database, async (client) => (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid ?? 0);
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
});

afterAll(async () => {
  await admin.end();
  await db.stop();
});

describe('N8 coupures de connexion (Neon)', () => {
  it('connexion inactive coupée par la base : erreur écoutée (code seul), processus intact, transaction suivante sur une connexion neuve', async () => {
    const lost: string[] = [];
    const database = createDatabase({ connectionString: db.getConnectionUri(), role: null, poolMax: 1, onConnectionLost: (code) => lost.push(code) });
    try {
      expect(database.pool.listenerCount('error')).toBe(1);
      const first = await pidOf(database);
      await admin.query('SELECT pg_terminate_backend($1)', [first]);
      await new Promise((resolveWait) => setTimeout(resolveWait, 300));
      expect(lost).toEqual(['57P01']);
      const second = await pidOf(database);
      expect(second).not.toBe(first);
    } finally {
      await database.pool.end();
    }
  });

  it('connexion coupée en pleine transaction : l’erreur remonte, la connexion est écartée, la suivante est neuve et rien n’a été validé', async () => {
    const database = createDatabase({ connectionString: db.getConnectionUri(), role: null, poolMax: 1, onConnectionLost: () => undefined });
    await admin.query('DROP TABLE IF EXISTS public.n8_probe');
    await admin.query('CREATE TABLE public.n8_probe (id int)');
    try {
      const first = await pidOf(database);
      await expect(withTransaction(database, async (client) => {
        await client.query('INSERT INTO public.n8_probe VALUES (1)');
        await admin.query('SELECT pg_terminate_backend($1)', [first]);
        await client.query('SELECT 1');
      })).rejects.toMatchObject({ code: '57P01' });
      expect(database.pool.totalCount).toBe(0);
      const second = await pidOf(database);
      expect(second).not.toBe(first);
      expect((await admin.query('SELECT count(*)::int AS n FROM public.n8_probe')).rows[0]).toEqual({ n: 0 });
    } finally {
      await database.pool.end();
      await admin.query('DROP TABLE IF EXISTS public.n8_probe');
    }
  });

  it('travailleur SMS : son pool écoute aussi les coupures et reprend sur une connexion neuve', async () => {
    const lost: string[] = [];
    // Par défaut, le rôle notification_worker est pris au démarrage de la session.
    const production = createNotifierPool('postgresql://molopay_notifier@127.0.0.1:1/molopay');
    expect((production as unknown as { options: { options?: string } }).options.options).toBe('-c role=notification_worker');
    await production.end();
    const pool = createNotifierPool(db.getConnectionUri(), { role: null, onConnectionLost: (code) => lost.push(code) });
    try {
      expect(pool.listenerCount('error')).toBe(1);
      const client = await pool.connect();
      const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
      client.release();
      await admin.query('SELECT pg_terminate_backend($1)', [pid]);
      await new Promise((resolveWait) => setTimeout(resolveWait, 300));
      expect(lost).toEqual(['57P01']);
      const again = await pool.connect();
      try {
        expect((await again.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid).not.toBe(pid);
      } finally {
        again.release();
      }
    } finally {
      await pool.end();
    }
  });

  it('travailleur SMS : connexion coupée pendant sa transaction : l’erreur remonte, la connexion est écartée, la suivante est neuve', async () => {
    const pool = createNotifierPool(db.getConnectionUri(), { role: null, onConnectionLost: () => undefined });
    try {
      const first = await committed(pool, async (client) => (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid ?? 0);
      await expect(committed(pool, async (client) => {
        await admin.query('SELECT pg_terminate_backend($1)', [first]);
        await client.query('SELECT 1');
      })).rejects.toMatchObject({ code: '57P01' });
      expect(pool.totalCount).toBe(0);
      const second = await committed(pool, async (client) => (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid ?? 0);
      expect(second).not.toBe(first);
    } finally {
      await pool.end();
    }
  });
});

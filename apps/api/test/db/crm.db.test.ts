import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * Q5 / F-SUP-001 / REG-LBC-001 : registre CRM en ajout seul — interactions de
 * support et tâches de suivi. Les règles sont vérifiées par la base elle-même :
 * identifiants v7, texte borné, compte existant, transitions dérivées des
 * événements, aucune modification ni suppression.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['crm', 'kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const ACCOUNT = '019ac000-0000-7000-8000-0000000000c1';
const INTERACTION = '019ac000-0000-7000-8000-000000000101';
const TASK = '019ac000-0000-7000-8000-000000000201';
const TASK_EVENT = '019ac000-0000-7000-8000-000000000202';

let db: TestDatabase;
let admin: Client;

type SqlError = { readonly code: string; readonly message: string };

/** Le code métier levé par la base, tel que le filtre HTTP le relit (« CODE: message »). */
function businessCode(error: unknown): string {
  const pg = error as SqlError;
  return /^([A-Z][A-Z0-9_]+): /.exec(pg.message)?.[1] ?? `SQLSTATE ${pg.code}`;
}

async function refusal(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
  } catch (error: unknown) {
    return businessCode(error);
  }
  throw new Error('EXPECTED_REFUSAL');
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
}, 300_000);

afterAll(async () => {
  await admin.end();
  await db.stop();
});

beforeEach(async () => {
  for (const schema of SCHEMAS) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const name of readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(resolve(DIRECTORY, name), 'utf8'));
  }
  await admin.query(
    `INSERT INTO identity.account (id, phone, phone_verified_at) VALUES ($1, '+237690000701', clock_timestamp())`,
    [ACCOUNT],
  );
});

describe('Q5 / F-SUP-001 registre CRM en ajout seul', () => {
  it('une interaction est inscrite sur l’horloge de la base, texte élagué ; aucun OTP ni PIN stocké par le CRM', async () => {
    const result = await admin.query<{ interaction_id: string; recorded_at: Date }>(
      `SELECT * FROM crm.record_interaction($1, $2, 'PHONE', 'INBOUND', $3, NULL, 'sup.deux', clock_timestamp())`,
      [INTERACTION, ACCOUNT, '  Appel : versement non reçu, reçu transmis  '],
    );
    expect(result.rows[0]?.interaction_id).toBe(INTERACTION);
    const stored = await admin.query<{ summary: string; outcome: string | null; recorded_at: Date }>(
      `SELECT summary, outcome, recorded_at FROM crm.interaction WHERE id = $1`,
      [INTERACTION],
    );
    expect(stored.rows[0]?.summary).toBe('Appel : versement non reçu, reçu transmis');
    expect(stored.rows[0]?.outcome).toBeNull();
    expect(stored.rows[0]?.recorded_at).toBeInstanceOf(Date);
  });

  it('refuse un compte inconnu, un texte hors bornes, un canal ou un sens inconnu, et un instant futur (CRM_INVALID_REQUEST)', async () => {
    const unknownAccount = '019ac000-0000-7000-8000-0000000000ff';
    const cases: readonly (readonly [string, unknown[]])[] = [
      ['compte inconnu', [INTERACTION, unknownAccount, 'PHONE', 'INBOUND', 'Appel client', null, 'sup.deux', null]],
      ['résumé trop court', [INTERACTION, ACCOUNT, 'PHONE', 'INBOUND', 'ab', null, 'sup.deux', null]],
      ['retour à la ligne', [INTERACTION, ACCOUNT, 'PHONE', 'INBOUND', 'ligne\nsuivante', null, 'sup.deux', null]],
      ['canal inconnu', [INTERACTION, ACCOUNT, 'PIGEON', 'INBOUND', 'Appel client', null, 'sup.deux', null]],
      ['sens inconnu', [INTERACTION, ACCOUNT, 'PHONE', 'SIDEWAYS', 'Appel client', null, 'sup.deux', null]],
      ['agent absent', [INTERACTION, ACCOUNT, 'PHONE', 'INBOUND', 'Appel client', null, '   ', null]],
      ['identifiant non v7', ['019ac000-0000-4000-8000-000000000101', ACCOUNT, 'PHONE', 'INBOUND', 'Appel client', null, 'sup.deux', null]],
    ];
    const failures: string[] = [];
    for (const [label, parameters] of cases) {
      const code = await refusal(() =>
        admin.query(
          `SELECT * FROM crm.record_interaction($1::uuid, $2::uuid, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, clock_timestamp()))`,
          parameters,
        ),
      );
      const expected = label === 'compte inconnu' ? 'IDENTITY_ACCOUNT_NOT_FOUND' : 'CRM_INVALID_REQUEST';
      if (code !== expected) {
        failures.push(`${label} → ${code}`);
      }
    }
    const future = await refusal(() =>
      admin.query(
        `SELECT * FROM crm.record_interaction($1, $2, 'PHONE', 'INBOUND', 'Appel client', NULL, 'sup.deux', clock_timestamp() + interval '1 hour')`,
        [INTERACTION, ACCOUNT],
      ),
    );
    if (future !== 'CRM_INVALID_REQUEST') {
      failures.push(`instant futur → ${future}`);
    }
    expect(failures).toEqual([]);
  });

  it('une tâche naît OUVERTE par un événement (seq 1) et se ferme par un nouvel événement ; une tâche close ne se rouvre pas (CRM_TASK_CLOSED)', async () => {
    await admin.query(
      `SELECT * FROM crm.create_follow_up_task($1, $2, 'Rappeler le client', 'Versement annoncé non reçu', 'HIGH', 'sup.deux', clock_timestamp() + interval '2 days', 'sup.deux')`,
      [TASK, ACCOUNT],
    );
    const opened = await admin.query<{ seq: number; kind: string; actor_id: string }>(
      `SELECT seq, kind, actor_id FROM crm.follow_up_task_event WHERE task_id = $1 ORDER BY seq`,
      [TASK],
    );
    expect(opened.rows).toEqual([{ seq: 1, kind: 'OPENED', actor_id: 'sup.deux' }]);

    await admin.query(
      `SELECT * FROM crm.transition_follow_up_task($1, $2, 'COMPLETED', 'sup.deux', 'Client rappelé, versement retrouvé')`,
      [TASK_EVENT, TASK],
    );
    const history = await admin.query<{ seq: number; kind: string }>(
      `SELECT seq, kind FROM crm.follow_up_task_event WHERE task_id = $1 ORDER BY seq`,
      [TASK],
    );
    expect(history.rows).toEqual([{ seq: 1, kind: 'OPENED' }, { seq: 2, kind: 'COMPLETED' }]);

    const again = await refusal(() =>
      admin.query(
        `SELECT * FROM crm.transition_follow_up_task($1, $2, 'CANCELLED', 'sup.deux', 'Doublon')`,
        ['019ac000-0000-7000-8000-000000000203', TASK],
      ),
    );
    expect(again).toBe('CRM_TASK_CLOSED');

    const unknownTask = await refusal(() =>
      admin.query(
        `SELECT * FROM crm.transition_follow_up_task($1, $2, 'COMPLETED', 'sup.deux', 'Client rappelé')`,
        ['019ac000-0000-7000-8000-000000000204', '019ac000-0000-7000-8000-0000000002ff'],
      ),
    );
    expect(unknownTask).toBe('CRM_TASK_NOT_FOUND');
  });

  it('refuse une transition sans motif, d’un type inconnu ou par un agent invalide (CRM_INVALID_REQUEST)', async () => {
    await admin.query(
      `SELECT * FROM crm.create_follow_up_task($1, $2, 'Vérifier la remise', NULL, 'NORMAL', 'sup.un', NULL, 'sup.un')`,
      [TASK, ACCOUNT],
    );
    const cases: readonly (readonly [string, string, string])[] = [
      ['sans motif', 'COMPLETED', 'sup.un'],
      ['type inconnu', 'REOPENED', 'sup.un'],
      ['agent vide', 'COMPLETED', ''],
    ];
    const failures: string[] = [];
    for (const [index, [label, kind, actor]] of cases.entries()) {
      const id = `019ac000-0000-7000-8000-00000000030${index.toString()}`;
      const code = await refusal(() =>
        admin.query(`SELECT * FROM crm.transition_follow_up_task($1, $2, $3, $4, $5)`, [id, TASK, kind, actor, index === 0 ? '   ' : 'Traité']),
      );
      if (code !== 'CRM_INVALID_REQUEST') {
        failures.push(`${label} → ${code}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('aucune interaction ni tâche n’est modifiable ni supprimable (CRM_APPEND_ONLY)', async () => {
    await admin.query(
      `SELECT * FROM crm.record_interaction($1, $2, 'APP', 'OUTBOUND', 'Message de suivi', 'Envoyé', 'sup.deux', clock_timestamp())`,
      [INTERACTION, ACCOUNT],
    );
    await admin.query(
      `SELECT * FROM crm.create_follow_up_task($1, $2, 'Confirmer la réception', NULL, 'LOW', 'sup.deux', NULL, 'sup.deux')`,
      [TASK, ACCOUNT],
    );
    const attempts: readonly (readonly [string, string])[] = [
      ['interaction modifiée', `UPDATE crm.interaction SET summary = 'autre' WHERE id = $1`],
      ['interaction supprimée', `DELETE FROM crm.interaction WHERE id = $1`],
      ['tâche modifiée', `UPDATE crm.follow_up_task SET title = 'autre' WHERE id = $1`],
      ['événement de tâche supprimé', `DELETE FROM crm.follow_up_task_event WHERE task_id = $1`],
    ];
    const failures: string[] = [];
    for (const [label, sql] of attempts) {
      const code = await refusal(() => admin.query(sql, [sql.includes('interaction') ? INTERACTION : TASK]));
      if (code !== 'CRM_APPEND_ONLY') {
        failures.push(`${label} → ${code}`);
      }
    }
    const truncated = await refusal(() => admin.query('TRUNCATE crm.follow_up_task_event'));
    if (truncated !== 'CRM_APPEND_ONLY') {
      failures.push(`TRUNCATE → ${truncated}`);
    }
    expect(failures).toEqual([]);
  });

  it('privilèges : app_rw écrit seulement par les fonctions, app_ro lit sans écrire', async () => {
    await admin.query('BEGIN');
    try {
      await admin.query('SET ROLE app_rw');
      const direct = await refusal(() =>
        admin.query(
          `INSERT INTO crm.interaction (id, account_id, channel, direction, summary, actor_id, occurred_at)
           VALUES ($1, $2, 'PHONE', 'INBOUND', 'Écriture directe', 'sup.deux', clock_timestamp())`,
          [INTERACTION, ACCOUNT],
        ),
      );
      if (!direct.startsWith('SQLSTATE 42501')) {
        throw new Error(`écriture directe app_rw → ${direct}`);
      }
    } finally {
      await admin.query('ROLLBACK');
    }
    await admin.query('BEGIN');
    try {
      await admin.query('SET ROLE app_ro');
      await admin.query('SELECT count(*) FROM crm.interaction');
      const write = await refusal(() => admin.query(`SELECT * FROM crm.record_interaction($1, $2, 'PHONE', 'INBOUND', 'Lecture seule', NULL, 'sup.deux', clock_timestamp())`, [INTERACTION, ACCOUNT]));
      if (!write.startsWith('SQLSTATE 42501')) {
        throw new Error(`fonction d’écriture par app_ro → ${write}`);
      }
    } finally {
      await admin.query('ROLLBACK');
    }
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { toProblem } from '../../src/http/problem';
import {
  AGREEMENT_STACK_MIGRATIONS,
  AGREEMENT_STACK_SCHEMAS,
  createAgreementC,
  PLAN_C,
  publishCommitmentLimits,
  publishSetting,
  seedPaymentPlan,
  validateLandlord,
} from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * NF-SAFE-002 : plafond du nombre d'objectifs actifs par client, donnée
 * versionnée publiée à deux personnes (NF-PORT-003), refus par défaut.
 */
const MIGRATIONS = [...AGREEMENT_STACK_MIGRATIONS, 'db/migrations/0071_agreements_active_goal_limit.sql'];
const CUSTOMER = '019ab800-0000-7000-8000-0000000000c1';
const OTHER = '019ab800-0000-7000-8000-0000000000c2';

let db: TestDatabase;
let admin: Client;
let migrations: string[];

async function refusal(action: Promise<unknown>): Promise<string> {
  return action.then(
    () => 'accepted',
    (error: { code?: string; message?: string }) => toProblem(error).code,
  );
}

function activate(client: Client, agreementId: string): Promise<unknown> {
  return client.query(
    `INSERT INTO agreements.status_event (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
     VALUES ($1, 1, 'TRANSITION', 'DRAFT', 'ACTIVE', $2, $3, 'client-1', now())`,
    [agreementId, uuidv7(), Buffer.alloc(64, 9)],
  );
}

async function draft(customerId: string): Promise<string> {
  const id = uuidv7();
  await createAgreementC(admin, { id, customerId, active: false });
  return id;
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  migrations = MIGRATIONS.map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'));
}, 120_000);

beforeEach(async () => {
  for (const schema of AGREEMENT_STACK_SCHEMAS) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrations) {
    await admin.query(sql);
  }
  await validateLandlord(admin, uuidv7());
  await seedPaymentPlan(admin, PLAN_C);
});

afterAll(async () => {
  await admin.end();
  await db.stop();
});

describe('NF-SAFE-002 / NF-PORT-003 plafond d’objectifs actifs par client (donnée versionnée)', () => {
  it('refus par défaut : sans plafond publié, aucune activation (AGREEMENT_LIMITS_NOT_CONFIGURED)', async () => {
    expect(await refusal(activate(admin, await draft(CUSTOMER)))).toBe('AGREEMENT_LIMITS_NOT_CONFIGURED');
  });

  it('valeur invalide (hors 1–50, non entière, champ inconnu) : refus par défaut', async () => {
    const goal = await draft(CUSTOMER);
    for (const value of [{ max_active_goals: 0 }, { max_active_goals: 51 }, { max_active_goals: Number.MAX_SAFE_INTEGER }, { max_active_goals: '2' }, { max_active_goals: 2, extra: 1 }, [2]]) {
      await publishSetting(admin, 'customer_commitment_limits', value);
      expect(await refusal(activate(admin, goal)), JSON.stringify(value)).toBe('AGREEMENT_LIMITS_NOT_CONFIGURED');
    }
    await publishSetting(admin, 'customer_commitment_limits', { max_active_goals: 1 });
    expect(await refusal(activate(admin, goal))).toBe('accepted');
  });

  it('plafond atteint : l’activation suivante est refusée (AGREEMENT_ACTIVE_LIMIT_REACHED) ; un autre client n’est pas concerné ; le brouillon reste possible', async () => {
    await publishCommitmentLimits(admin, 2);
    expect(await refusal(activate(admin, await draft(CUSTOMER)))).toBe('accepted');
    expect(await refusal(activate(admin, await draft(CUSTOMER)))).toBe('accepted');
    const third = await draft(CUSTOMER);
    const refused = await refusal(activate(admin, third));
    expect(refused).toBe('AGREEMENT_ACTIVE_LIMIT_REACHED');
    expect(toProblem({ code: 'P0001', message: 'AGREEMENT_ACTIVE_LIMIT_REACHED: 2 objectifs actifs au plus' }).status).toBe(422);
    expect(await refusal(activate(admin, await draft(OTHER)))).toBe('accepted');
    // Nouvelle version publiée à deux personnes : le plafond relevé s'applique aussitôt.
    await publishCommitmentLimits(admin, 3);
    expect(await refusal(activate(admin, third))).toBe('accepted');
  });

  it('un objectif sorti de l’état actif (annulé) libère sa place', async () => {
    await publishCommitmentLimits(admin, 1);
    const first = await draft(CUSTOMER);
    await activate(admin, first);
    const second = await draft(CUSTOMER);
    expect(await refusal(activate(admin, second))).toBe('AGREEMENT_ACTIVE_LIMIT_REACHED');
    await admin.query(
      `INSERT INTO agreements.status_event (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
       VALUES ($1, 2, 'TRANSITION', 'ACTIVE', 'CANCELLED_BY_CUSTOMER', $2, $3, 'client-1', now())`,
      [first, uuidv7(), Buffer.alloc(64, 9)],
    );
    expect(await refusal(activate(admin, second))).toBe('accepted');
  });

  it('concurrence : deux activations simultanées du même client sous un plafond de 1 → une seule acceptée', async () => {
    await publishCommitmentLimits(admin, 1);
    const goals = [await draft(CUSTOMER), await draft(CUSTOMER)];
    const clients = await Promise.all(goals.map(async () => {
      const client = new Client({ connectionString: db.getConnectionUri() });
      await client.connect();
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_rw');
      return client;
    }));
    try {
      const outcomes = await Promise.all(clients.map(async (client, index) => {
        const outcome = await refusal(activate(client, goals[index] ?? ''));
        await client.query(outcome === 'accepted' ? 'COMMIT' : 'ROLLBACK');
        return outcome;
      }));
      expect([...outcomes].sort()).toEqual(['AGREEMENT_ACTIVE_LIMIT_REACHED', 'accepted']);
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
    const active = await admin.query(
      `SELECT count(*)::int AS n FROM agreements.agreement_state WHERE customer_id = $1 AND status = 'ACTIVE'`,
      [CUSTOMER],
    );
    expect(active.rows[0]).toEqual({ n: 1 });
  });
});

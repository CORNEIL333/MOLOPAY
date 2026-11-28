import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalize } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getPaymentPlan,
  paymentPlanApprovalPayload,
  recordApprovedPaymentPlan,
  type PaymentPlanTerms,
} from '../../src/modules/catalog/payment-plan.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
  'db/migrations/0002_audit.sql',
  'db/migrations/0005_audit_metadata.sql',
  'db/migrations/0010_audit_catalog.sql',
  'db/migrations/0003_admin.sql',
  'db/migrations/0006_admin_clock.sql',
  'db/migrations/0008_catalog_partner.sql',
  'db/migrations/0009_catalog_offer.sql',
  'db/migrations/0033_payment_plans.sql',
].map((path) => resolve(process.cwd(), path));

const PLAN: PaymentPlanTerms = {
  planId: 'plan-c-mensuel',
  model: 'PLANNED_EXPENSE',
  rhythm: 'MONTHLY',
  minAmountXaf: 10_000n,
  maxDurationMonths: 12,
};

let container: TestDatabase;
let admin: Client;
let migrationSql: string[];

async function transact<T>(
  role: 'app_rw' | 'app_ro' | null,
  action: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (role !== null) {
      await client.query(`SET LOCAL ROLE ${role}`);
    }
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function failure(action: () => Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  try {
    await action();
  } catch (error: unknown) {
    if (error instanceof BusinessError) {
      return { code: error.code, message: error.message };
    }
    const pg = error as { code?: string; message?: string };
    return { code: pg.code, message: pg.message ?? '' };
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

/** Demande maker-checker posée en base, comme le ferait le back-office. */
async function approval(
  payload: Record<string, string>,
  options: { kind?: string; decision?: 'APPROVED' | 'REJECTED' | null } = {},
): Promise<string> {
  const id = uuidv7();
  const payloadHash = createHash('sha256').update(canonicalize(payload), 'utf8').digest();
  await transact('app_rw', async (client) => {
    await client.query(
      `INSERT INTO admin.approval_request
         (id, kind, maker_id, payload, payload_hash, reason, prepared_at, expires_at)
       VALUES ($1, $2, 'fin-1', $3::jsonb, $4, 'Nouveau plan', now(), now() + interval '1 day')`,
      [id, options.kind ?? 'PAYMENT_PLAN', JSON.stringify(payload), payloadHash],
    );
    const decision = options.decision === undefined ? 'APPROVED' : options.decision;
    if (decision !== null) {
      await client.query(
        `INSERT INTO admin.approval_decision (request_id, decision, decided_by, decided_at, decision_reason)
         VALUES ($1, $2, 'comp-1', now(), $3)`,
        [id, decision, decision === 'REJECTED' ? 'Plan refusé' : null],
      );
    }
  });
  return id;
}

async function record(terms: PaymentPlanTerms, approvalRequestId: string): Promise<void> {
  return transact('app_rw', (client) => recordApprovedPaymentPlan(client, { terms, approvalRequestId }));
}

beforeAll(async () => {
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  migrationSql = await Promise.all(MIGRATIONS.map((path) => readFile(path, 'utf8')));
}, 120_000);

afterAll(async () => {
  await admin.end();
  await container.stop();
});

beforeEach(async () => {
  for (const schema of ['catalog', 'admin', 'audit']) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
});

describe('D26 / F-CAT-002 registre des plans approuvés', () => {
  it('enregistre un plan approuvé par maker-checker et le relit à l’identique', async () => {
    const requestId = await approval(paymentPlanApprovalPayload(PLAN));
    await record(PLAN, requestId);
    const stored = await transact('app_ro', (client) => getPaymentPlan(client, PLAN.planId));
    expect(stored).toMatchObject({ ...PLAN, approvalRequestId: requestId });
  });

  it('la base admin accepte le nouveau type PAYMENT_PLAN', async () => {
    const requestId = await approval(paymentPlanApprovalPayload(PLAN), { decision: null });
    const row = await admin.query('SELECT kind FROM admin.approval_request WHERE id = $1', [requestId]);
    expect(row.rows[0]).toEqual({ kind: 'PAYMENT_PLAN' });
  });

  it.each([
    ['en attente', { decision: null }],
    ['refusée', { decision: 'REJECTED' as const }],
    ['d’un autre type', { kind: 'FINANCIAL_SETTING' }],
  ])('refuse un plan dont la demande est %s (CATALOG_PLAN_NOT_APPROVED)', async (_label, options) => {
    const requestId = await approval(paymentPlanApprovalPayload(PLAN), options);
    const result = await failure(() => record(PLAN, requestId));
    expect(result.message).toMatch(/^CATALOG_PLAN_NOT_APPROVED/);
  });

  it('refuse un plan différent de celui approuvé (CATALOG_PLAN_NOT_APPROVED)', async () => {
    const requestId = await approval(paymentPlanApprovalPayload(PLAN));
    const result = await failure(() => record({ ...PLAN, minAmountXaf: 5_000n }, requestId));
    expect(result.message).toMatch(/^CATALOG_PLAN_NOT_APPROVED/);
  });

  it('F-CAT-002 refuse une approbation qui porte un frais ou un taux (CATALOG_FIELD_FORBIDDEN)', async () => {
    const requestId = await approval({ ...paymentPlanApprovalPayload(PLAN), fee_rate: '0.05' });
    const result = await failure(() => record(PLAN, requestId));
    expect(result.message).toMatch(/^CATALOG_FIELD_FORBIDDEN/);
  });

  it('une approbation déjà utilisée ne peut pas servir à un autre plan (CATALOG_PLAN_NOT_APPROVED)', async () => {
    const requestId = await approval(paymentPlanApprovalPayload(PLAN));
    await record(PLAN, requestId);
    const result = await failure(() => record({ ...PLAN, planId: 'plan-autre' }, requestId));
    expect(result.message).toMatch(/^CATALOG_PLAN_NOT_APPROVED/);
  });

  it('le même plan ne s’inscrit qu’une fois (23505)', async () => {
    await record(PLAN, await approval(paymentPlanApprovalPayload(PLAN)));
    const result = await failure(async () => record(PLAN, await approval(paymentPlanApprovalPayload(PLAN))));
    expect(result.code).toBe('23505');
  });

  it('D26 la base refuse le modèle B et une durée hors 1–36 mois, même approuvés (23514)', async () => {
    for (const [model, months] of [['FINANCED_PURCHASE', '12'], ['PLANNED_EXPENSE', '37'], ['PLANNED_EXPENSE', '0']] as const) {
      // Charge approuvée cohérente : seul le CHECK de la table peut refuser.
      const requestId = await approval({
        plan_id: 'plan-x',
        model,
        rhythm: 'MONTHLY',
        min_amount_xaf: '10000',
        max_duration_months: months,
      });
      const result = await failure(() =>
        transact('app_rw', (client) =>
          client.query(
            `INSERT INTO catalog.payment_plan
               (id, model, rhythm, min_amount_xaf, max_duration_months, approval_request_id, approved_at)
             VALUES ('plan-x', $1, 'MONTHLY', 10000, $2::int, $3, now())`,
            [model, months, requestId],
          ),
        ),
      );
      expect(result.code, `${model} ${months}`).toBe('23514');
    }
  });

  it('les plans sont en ajout seul (CATALOG_APPEND_ONLY)', async () => {
    await record(PLAN, await approval(paymentPlanApprovalPayload(PLAN)));
    for (const sql of ['UPDATE catalog.payment_plan SET min_amount_xaf = 1', 'DELETE FROM catalog.payment_plan']) {
      const result = await failure(() => admin.query(sql));
      expect(result.message, sql).toMatch(/APPEND_ONLY/);
    }
  });
});

describe('D26 validation du plan avant la base', () => {
  it.each([
    ['modèle B', { model: 'FINANCED_PURCHASE' }],
    ['rythme inconnu', { rhythm: 'YEARLY' }],
    ['minimum nul', { minAmountXaf: 0n }],
    ['durée 37 mois', { maxDurationMonths: 37 }],
    ['identifiant invalide', { planId: 'plan c' }],
  ])('refuse un plan avec %s (CATALOG_INVALID_REQUEST)', (_label, override) => {
    let code: string | undefined;
    try {
      paymentPlanApprovalPayload({ ...PLAN, ...override } as PaymentPlanTerms);
    } catch (error: unknown) {
      code = error instanceof BusinessError ? error.code : undefined;
    }
    expect(code).toBe('CATALOG_INVALID_REQUEST');
  });
});

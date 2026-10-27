import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalize, type JsonValue } from '@achat/chain';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPartnerDossier,
  partnerDossierHash,
  type PartnerApprovalDecision,
  type PartnerDossier,
} from '../../src/modules/catalog/partner';
import {
  appendPartnerDossier,
  getPartner,
  recordPartnerValidation,
} from '../../src/modules/catalog/partner.store';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
  'db/migrations/0003_admin.sql',
  'db/migrations/0006_admin_clock.sql',
  'db/migrations/0008_catalog_partner.sql',
].map((path) => resolve(process.cwd(), path));

const PREPARED_AT = '2026-10-27T08:00:00.000Z';
const EXPIRES_AT = '2026-10-28T08:00:00.000Z';

let container: TestDatabase;
let admin: Client;
let migrationSql: string[];

function uuid(seq: number): string {
  return `019a9000-0000-7000-8000-${seq.toString().padStart(12, '0')}`;
}

function dossier(overrides: Partial<PartnerDossier> = {}): PartnerDossier {
  return createPartnerDossier({
    partnerId: 'partner-1',
    legalName: 'Électro Douala SARL',
    rccm: 'RC/DLA/2024/B/0001',
    niu: 'M000000000000A',
    representativeDocumentRef: 'kyc-doc-ref-0001',
    settlementAccountRef: 'settlement-ref-0001',
    ...overrides,
  });
}

function approvalPayload(target: PartnerDossier): Record<string, JsonValue> {
  return {
    partner_id: target.partnerId,
    dossier_hash: partnerDossierHash(target).toString('hex'),
  };
}

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

/** Crée une demande et sa décision ; renvoie la vue structurelle attendue. */
async function approve(
  client: Client,
  options: {
    readonly id: string;
    readonly payload: Record<string, JsonValue>;
    readonly kind?: string;
    readonly decision?: 'APPROVED' | 'REJECTED';
  },
): Promise<PartnerApprovalDecision> {
  const payloadHash = createHash('sha256')
    .update(canonicalize(options.payload), 'utf8')
    .digest();
  await client.query(
    `INSERT INTO admin.approval_request
       (id, kind, maker_id, payload, payload_hash, reason, prepared_at, expires_at)
     VALUES ($1, $2, 'net-1', $3::jsonb, $4, 'Onboarding partenaire', $5, $6)`,
    [
      options.id,
      options.kind ?? 'PARTNER_APPROVAL',
      JSON.stringify(options.payload),
      payloadHash,
      PREPARED_AT,
      EXPIRES_AT,
    ],
  );
  const decision = options.decision ?? 'APPROVED';
  await client.query(
    `INSERT INTO admin.approval_decision
       (request_id, decision, decided_by, decided_at, decision_reason)
     VALUES ($1, $2, 'comp-1', now(), NULL)`,
    [options.id, decision],
  );
  return {
    id: options.id,
    kind: options.kind ?? 'PARTNER_APPROVAL',
    status: decision,
    makerId: 'net-1',
    checkerId: 'comp-1',
    payload: options.payload,
    payloadHash,
  };
}

async function insertValidation(
  client: Client,
  requestId: string,
  dossierVersion = 1,
): Promise<void> {
  await client.query(
    `INSERT INTO catalog.partner_validation
       (partner_id, dossier_version, approval_request_id, validated_at)
     VALUES ('partner-1', $1, $2, '2000-01-01T00:00:00Z')`,
    [dossierVersion, requestId],
  );
}

async function catchFailure(action: () => Promise<unknown>): Promise<{
  code: string | undefined;
  message: string;
}> {
  try {
    await action();
  } catch (error: unknown) {
    const failure = error as { code?: string; message?: string };
    return { code: failure.code, message: failure.message ?? '' };
  }
  throw new Error('Échec attendu, aucune erreur levée');
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
  await admin.query('DROP SCHEMA IF EXISTS catalog CASCADE');
  await admin.query('DROP SCHEMA IF EXISTS admin CASCADE');
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
});

describe('F-PRT-001 · onboarding partenaire (PostgreSQL réel)', () => {
  it('F-PRT-001 un partenaire avec dossier non validé est PENDING', async () => {
    await transact('app_rw', (client) => appendPartnerDossier(client, dossier(), 'net-1'));
    const partner = await transact('app_ro', (client) => getPartner(client, 'partner-1'));
    expect(partner).toEqual({ id: 'partner-1', status: 'PENDING' });
  });

  it('F-PRT-001 valide après approbation maker-checker du dossier exact', async () => {
    const validation = await transact('app_rw', async (client) => {
      const stored = await appendPartnerDossier(client, dossier(), 'net-1');
      const decision = await approve(client, {
        id: uuid(1),
        payload: approvalPayload(stored.dossier),
      });
      return recordPartnerValidation(client, {
        partnerId: 'partner-1',
        dossierVersion: stored.version,
        decision,
      });
    });
    expect(validation.requestId).toBe(uuid(1));
    const partner = await transact('app_ro', (client) => getPartner(client, 'partner-1'));
    expect(partner).toEqual({ id: 'partner-1', status: 'VALIDATED' });
  });

  it('F-PRT-001 ancre created_at et validated_at sur l’horloge serveur', async () => {
    await transact('app_rw', async (client) => {
      await client.query(
        `INSERT INTO catalog.partner_dossier
           (partner_id, version, legal_name, rccm, niu,
            representative_document_ref, settlement_account_ref,
            dossier_hash, created_by, created_at)
         VALUES ('partner-1', 1, 'Électro Douala SARL', 'RC/DLA/2024/B/0001',
                 'M000000000000A', 'kyc-doc-ref-0001', 'settlement-ref-0001',
                 $1, 'net-1', '2000-01-01T00:00:00Z')`,
        [partnerDossierHash(dossier())],
      );
      await approve(client, { id: uuid(1), payload: approvalPayload(dossier()) });
      await insertValidation(client, uuid(1));
    });
    const rows = await admin.query<{ created_at: Date; validated_at: Date }>(
      `SELECT d.created_at, v.validated_at
       FROM catalog.partner_dossier d
       JOIN catalog.partner_validation v USING (partner_id)`,
    );
    expect(rows.rows[0]?.created_at.getUTCFullYear()).toBeGreaterThan(2000);
    expect(rows.rows[0]?.validated_at.getUTCFullYear()).toBeGreaterThan(2000);
  });

  it('F-PRT-001 refuse une validation sur demande rejetée', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await appendPartnerDossier(client, dossier(), 'net-1');
        await approve(client, {
          id: uuid(1),
          payload: approvalPayload(dossier()),
          decision: 'REJECTED',
        });
        await insertValidation(client, uuid(1));
      }),
    );
    expect(failure.message).toContain('CATALOG_PARTNER_NOT_VALIDATED');
  });

  it('F-PRT-001 refuse une demande approuvée d’un autre type', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await appendPartnerDossier(client, dossier(), 'net-1');
        await approve(client, {
          id: uuid(1),
          kind: 'FINANCIAL_SETTING',
          payload: approvalPayload(dossier()),
        });
        await insertValidation(client, uuid(1));
      }),
    );
    expect(failure.message).toContain('CATALOG_PARTNER_NOT_VALIDATED');
  });

  it('F-PRT-001 refuse une charge approuvée hors liste blanche', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await appendPartnerDossier(client, dossier(), 'net-1');
        await approve(client, {
          id: uuid(1),
          payload: { ...approvalPayload(dossier()), status: 'VALIDATED' },
        });
        await insertValidation(client, uuid(1));
      }),
    );
    expect(failure.message).toContain('CATALOG_FIELD_FORBIDDEN');
  });

  it('F-PRT-001 refuse une approbation portant sur une autre empreinte', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await appendPartnerDossier(client, dossier(), 'net-1');
        await approve(client, {
          id: uuid(1),
          payload: approvalPayload(dossier({ settlementAccountRef: 'settlement-ref-0002' })),
        });
        await insertValidation(client, uuid(1));
      }),
    );
    expect(failure.message).toContain('CATALOG_PARTNER_NOT_VALIDATED');
  });

  it('F-PRT-001 un dossier modifié après validation repasse PENDING', async () => {
    await transact('app_rw', async (client) => {
      const stored = await appendPartnerDossier(client, dossier(), 'net-1');
      const decision = await approve(client, {
        id: uuid(1),
        payload: approvalPayload(stored.dossier),
      });
      await recordPartnerValidation(client, {
        partnerId: 'partner-1',
        dossierVersion: stored.version,
        decision,
      });
      await appendPartnerDossier(
        client,
        dossier({ settlementAccountRef: 'settlement-ref-0002' }),
        'net-1',
      );
    });
    const partner = await transact('app_ro', (client) => getPartner(client, 'partner-1'));
    expect(partner).toEqual({ id: 'partner-1', status: 'PENDING' });
  });

  it('F-PRT-001 refuse de valider une version remplacée', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await appendPartnerDossier(client, dossier(), 'net-1');
        await appendPartnerDossier(
          client,
          dossier({ settlementAccountRef: 'settlement-ref-0002' }),
          'net-1',
        );
        await approve(client, { id: uuid(1), payload: approvalPayload(dossier()) });
        await insertValidation(client, uuid(1), 1);
      }),
    );
    expect(failure.message).toContain('CATALOG_PARTNER_NOT_VALIDATED');
  });

  it('F-PRT-002 refuse une version de dossier non consécutive', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query(
          `INSERT INTO catalog.partner_dossier
             (partner_id, version, legal_name, rccm, niu,
              representative_document_ref, settlement_account_ref,
              dossier_hash, created_by, created_at)
           VALUES ('partner-1', 2, 'X', 'R', 'N', 'K', 'S', $1, 'net-1', now())`,
          [Buffer.alloc(32, 1)],
        );
      }),
    );
    expect(failure.message).toContain('CATALOG_INVALID_REQUEST');
  });

  it('SEC-AUTHZ-003 une même approbation ne valide qu’une fois', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await appendPartnerDossier(client, dossier(), 'net-1');
        await approve(client, { id: uuid(1), payload: approvalPayload(dossier()) });
        await insertValidation(client, uuid(1));
        await insertValidation(client, uuid(1));
      }),
    );
    expect(failure.code).toBe('23505');
  });

  it('F-PRT-002 dossiers et validations sont en ajout seul', async () => {
    await transact('app_rw', async (client) => {
      await appendPartnerDossier(client, dossier(), 'net-1');
      await approve(client, { id: uuid(1), payload: approvalPayload(dossier()) });
      await insertValidation(client, uuid(1));
    });
    for (const statement of [
      "UPDATE catalog.partner_dossier SET settlement_account_ref = 'pirate'",
      'DELETE FROM catalog.partner_validation',
    ]) {
      const asApp = await catchFailure(() =>
        transact('app_rw', (client) => client.query(statement)),
      );
      expect(asApp.code).toBe('42501');
      const asOwner = await catchFailure(() => admin.query(statement));
      expect(asOwner.message).toContain('CATALOG_APPEND_ONLY');
    }
    const truncate = await catchFailure(() =>
      admin.query('TRUNCATE catalog.partner_validation'),
    );
    expect(truncate.message).toContain('CATALOG_APPEND_ONLY');
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminPrincipal } from '../../src/modules/admin/domain';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { declareLegalNameAndScreen } from '../../src/workflows/kyc-basic-level';
import { reviewSanctionsMatch } from '../../src/workflows/sanctions-screening';
import { seedCustomerAccount } from './agreement-fixture';
import { importListAsImporter } from './kyc-list-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * REG-LBC-001 / REG-LBC-002 / F-ACC-003 (D68) : niveau KYC 1 = numéro
 * vérifié + nom déclaré + filtrage ONU de ce nom ; élévation par la base
 * seulement. PostgreSQL réel, toutes les migrations, extrait réel de la liste.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const EXCERPT = readFileSync(resolve(process.cwd(), 'apps/api/src/modules/kyc/fixtures/un-consolidated-excerpt.xml'), 'utf8');
const CUSTOMER = '019ab500-0000-7000-8000-0000000000c1';
const COMPLIANCE: AdminPrincipal = { actorId: 'comp-1', roles: ['COMPLIANCE'] };
const SECOND_COMPLIANCE: AdminPrincipal = { actorId: 'comp-2', roles: ['COMPLIANCE'] };

let container: TestDatabase;
let admin: Client;
let migrations: string[];

async function transact<T>(action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_rw');
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
    if (error instanceof BusinessError) return { code: error.code, message: error.message };
    const pg = error as { code?: string; message?: string };
    return { code: pg.code, message: pg.message ?? '' };
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

async function level(): Promise<string> {
  return (await admin.query<{ kyc_level: string }>('SELECT kyc_level FROM identity.account WHERE id = $1', [CUSTOMER])).rows[0]?.kyc_level ?? '';
}

function declare(legalName: string): ReturnType<typeof declareLegalNameAndScreen> {
  return transact((client) => declareLegalNameAndScreen(client, { accountId: CUSTOMER, legalName }));
}

async function importList(): Promise<void> {
  await importListAsImporter(container.getConnectionUri(), { versionId: uuidv7(), xml: EXCERPT, sourceUrl: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml', actorId: 'comp-1' });
}

beforeAll(async () => {
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
}, 120_000);

afterAll(async () => {
  await admin.end();
  await container.stop();
});

beforeEach(async () => {
  for (const schema of SCHEMAS) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrations) {
    await admin.query(sql);
  }
  await seedCustomerAccount(admin, CUSTOMER, 'NONE');
});

describe('REG-LBC-001 niveau 1 : nom déclaré et filtré (D68)', () => {
  it('nom sans rapprochement : niveau BASIC accordé dans la même transaction', async () => {
    await importList();
    const result = await declare('Aïcha Ngono Mballa');
    expect(result).toMatchObject({ outcome: 'CLEAR', kycLevel: 'BASIC' });
    expect(await level()).toBe('BASIC');
    const stored = await admin.query('SELECT legal_name FROM identity.legal_name_declaration WHERE account_id = $1', [CUSTOMER]);
    expect(stored.rows).toEqual([{ legal_name: 'Aïcha Ngono Mballa' }]);
  });

  it('sans liste importée : refus, rien n’est enregistré, niveau inchangé', async () => {
    expect((await failure(() => declare('Aïcha Ngono Mballa'))).code).toBe('KYC_LIST_UNAVAILABLE');
    expect(await level()).toBe('NONE');
    expect((await admin.query('SELECT count(*)::int AS n FROM identity.legal_name_declaration')).rows[0]).toEqual({ n: 0 });
  });

  it('rapprochement : niveau en attente ; faux positif examiné par la Conformité → BASIC ; correspondance confirmée → reste NONE', async () => {
    await importList();
    const pending = await declare('Eric Badege');
    expect(pending).toMatchObject({ outcome: 'POTENTIAL_MATCH', kycLevel: 'SCREENING_PENDING_REVIEW' });
    expect(await level()).toBe('NONE');
    await transact((client) => reviewSanctionsMatch(client, { principal: COMPLIANCE, screeningId: pending.screeningId, decision: 'CONFIRMED_MATCH', reason: 'correspondance avérée' }));
    expect(await level()).toBe('NONE');
    const direct = await transact(async (client) => (await client.query<{ level: string }>('SELECT kyc.grant_basic_level($1) AS level', [CUSTOMER])).rows[0]?.level);
    expect(direct).toBe('SCREENING_CONFIRMED_MATCH');
    expect(await level()).toBe('NONE');
    const again = await declare('Eric Badege Junior');
    expect(await transact((client) => reviewSanctionsMatch(client, { principal: COMPLIANCE, screeningId: again.screeningId, decision: 'FALSE_POSITIVE', reason: 'date de naissance différente' }))).toBe('PROPOSED');
    expect(await level()).toBe('NONE');
    expect(await transact((client) => reviewSanctionsMatch(client, { principal: SECOND_COMPLIANCE, screeningId: again.screeningId, decision: 'FALSE_POSITIVE', reason: 'pièce vérifiée, homonyme' }))).toBe('RECORDED');
    expect(await level()).toBe('BASIC');
  });

  it('compte bloqué pendant l’examen : le faux positif ne débloque pas le niveau', async () => {
    await importList();
    const pending = await declare('Eric Badege');
    await admin.query(`UPDATE identity.account SET status = 'BLOCKED', blocked_at = now(), block_channel = 'APP', block_reason = 'LOST_OR_STOLEN' WHERE id = $1`, [CUSTOMER]);
    await transact((client) => reviewSanctionsMatch(client, { principal: COMPLIANCE, screeningId: pending.screeningId, decision: 'FALSE_POSITIVE', reason: 'homonyme' }));
    await transact((client) => reviewSanctionsMatch(client, { principal: SECOND_COMPLIANCE, screeningId: pending.screeningId, decision: 'FALSE_POSITIVE', reason: 'homonyme confirmé' }));
    expect(await level()).toBe('NONE');
  });

  it('I-4 / I-7 un rapprochement client ne s’écarte qu’à deux personnes ; une seule personne : MAKER_CANNOT_APPROVE ; la base refuse un écartement sans proposition', async () => {
    await importList();
    const pending = await declare('Eric Badege');
    expect(await transact((client) => reviewSanctionsMatch(client, { principal: COMPLIANCE, screeningId: pending.screeningId, decision: 'FALSE_POSITIVE', reason: 'homonyme' }))).toBe('PROPOSED');
    expect(await level()).toBe('NONE');
    const self = await failure(() => transact((client) => reviewSanctionsMatch(client, { principal: COMPLIANCE, screeningId: pending.screeningId, decision: 'FALSE_POSITIVE', reason: 'je confirme' })));
    expect(self.code).toBe('MAKER_CANNOT_APPROVE');
    expect(await level()).toBe('NONE');
    const direct = await failure(() =>
      transact((client) => client.query(`INSERT INTO kyc.screening_review (screening_id, decision, reason, reviewed_by, reviewed_at) VALUES ($1, 'FALSE_POSITIVE', 'x', 'comp-1', now())`, [pending.screeningId])),
    );
    expect(direct.message).toMatch(/^MAKER_CANNOT_APPROVE/);
    const other = await declare('Eric Badege Junior');
    const unproposed = await failure(() =>
      transact((client) => client.query(`INSERT INTO kyc.screening_review (screening_id, decision, reason, reviewed_by, reviewed_at) VALUES ($1, 'FALSE_POSITIVE', 'x', 'comp-9', now())`, [other.screeningId])),
    );
    expect(unproposed.message).toMatch(/^KYC_INVALID_REQUEST: écartement d'un rapprochement client sans proposition préalable/);
    const proposalOfScreener = await failure(() =>
      transact((client) => client.query(`INSERT INTO kyc.screening_review_proposal (screening_id, decision, reason, proposed_by, proposed_at) VALUES ($1, 'FALSE_POSITIVE', 'x', 'kyc-self-declaration', now())`, [other.screeningId])),
    );
    expect(proposalOfScreener.message).toMatch(/^MAKER_CANNOT_APPROVE/);
    expect(await transact((client) => reviewSanctionsMatch(client, { principal: SECOND_COMPLIANCE, screeningId: pending.screeningId, decision: 'FALSE_POSITIVE', reason: 'pièce vérifiée' }))).toBe('RECORDED');
    // La dernière déclaration (« Junior ») attend encore son propre examen à deux personnes.
    expect(await level()).toBe('NONE');
    expect(await transact((client) => reviewSanctionsMatch(client, { principal: SECOND_COMPLIANCE, screeningId: other.screeningId, decision: 'FALSE_POSITIVE', reason: 'homonyme' }))).toBe('PROPOSED');
    expect(await transact((client) => reviewSanctionsMatch(client, { principal: COMPLIANCE, screeningId: other.screeningId, decision: 'FALSE_POSITIVE', reason: 'pièce vérifiée' }))).toBe('RECORDED');
    expect(await level()).toBe('BASIC');
    const late = await failure(() =>
      transact((client) => client.query(`INSERT INTO kyc.screening_review_proposal (screening_id, decision, reason, proposed_by, proposed_at) VALUES ($1, 'FALSE_POSITIVE', 'x', 'comp-3', now())`, [pending.screeningId])),
    );
    expect(late.message).toMatch(/^KYC_INVALID_REQUEST: rapprochement déjà examiné/);
    const mutation = await failure(() => transact((client) => client.query(`UPDATE kyc.screening_review_proposal SET proposed_by = 'comp-2'`)));
    expect(mutation.message).toMatch(/^(KYC_APPEND_ONLY|permission denied)/);
  });

  it('I-4 une correspondance confirmée reste décidée par une personne (sens restrictif)', async () => {
    await importList();
    const pending = await declare('Eric Badege');
    expect(await transact((client) => reviewSanctionsMatch(client, { principal: COMPLIANCE, screeningId: pending.screeningId, decision: 'CONFIRMED_MATCH', reason: 'correspondance avérée' }))).toBe('RECORDED');
    const after = await failure(() => transact((client) => reviewSanctionsMatch(client, { principal: SECOND_COMPLIANCE, screeningId: pending.screeningId, decision: 'FALSE_POSITIVE', reason: 'revu' })));
    expect(after.message).toMatch(/^KYC_INVALID_REQUEST: rapprochement déjà examiné/);
    expect(await level()).toBe('NONE');
  });

  it('nom invalide refusé ; compte bloqué refusé', async () => {
    await importList();
    for (const name of ['', ' X', 'A', 'Nom\u0000caché']) {
      expect((await failure(() => declare(name))).code).toMatch(/KYC_INVALID_REQUEST|IDENTITY_INVALID_REQUEST/);
    }
    await admin.query(`UPDATE identity.account SET status = 'BLOCKED', blocked_at = now(), block_channel = 'APP', block_reason = 'LOST_OR_STOLEN' WHERE id = $1`, [CUSTOMER]);
    expect((await failure(() => declare('Aïcha Ngono Mballa'))).message).toMatch(/IDENTITY_ACCOUNT_BLOCKED/);
  });

  it('base garante : le filtrage d’un autre nom ou d’un autre client ne débloque rien ; aucune mise à jour directe du niveau', async () => {
    await importList();
    const other = '019ab500-0000-7000-8000-0000000000c2';
    await seedCustomerAccount(admin, other, 'NONE');
    const theirs = await transact((client) => declareLegalNameAndScreen(client, { accountId: other, legalName: 'Paul Atangana' }));
    const mine = (await admin.query<{ id: string }>(
      `INSERT INTO identity.legal_name_declaration (id, account_id, legal_name, declared_at) VALUES ($1, $2, 'Eric Badege', now()) RETURNING id`,
      [uuidv7(), CUSTOMER],
    )).rows[0]?.id;
    const link = await failure(() => transact((client) => client.query('INSERT INTO kyc.legal_name_screening (declaration_id, screening_id) VALUES ($1, $2)', [mine, theirs.screeningId])));
    expect(link.message).toMatch(/^KYC_INVALID_REQUEST: filtrage d'un autre client/);
    expect(await transact(async (client) => (await client.query<{ level: string }>('SELECT kyc.grant_basic_level($1) AS level', [CUSTOMER])).rows[0]?.level)).toBe('SCREENING_MISSING');
    expect(await level()).toBe('NONE');
    expect((await failure(() => transact((client) => client.query(`UPDATE identity.account SET kyc_level = 'BASIC' WHERE id = $1`, [CUSTOMER])))).message).toMatch(/^permission denied/);
  });

  it('nouvelle déclaration après BASIC : le niveau acquis n’est pas retiré automatiquement (⚖ D68)', async () => {
    await importList();
    await declare('Aïcha Ngono Mballa');
    const second = await declare('Eric Badege');
    expect(second).toMatchObject({ outcome: 'POTENTIAL_MATCH', kycLevel: 'BASIC' });
    expect(await level()).toBe('BASIC');
  });
});

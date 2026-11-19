import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { normalizeName } from '../../src/modules/kyc/name-match';
import { importUnSanctionsList } from '../../src/modules/kyc/sanctions.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { declareLegalNameAndScreen } from '../../src/workflows/kyc-basic-level';
import { seedCustomerAccount } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * I-2 / I-5 (revue indépendante) : la base ne se contente plus de la parole de
 * l'application. Un filtrage doit utiliser la version de liste la plus
 * récente et ses références rapprochées sont recalculées en base ; un
 * filtrage rattaché à une déclaration doit porter le nom déclaré ; une
 * version de liste ne peut ni venir d'un autre hôte ni être datée du futur.
 * PostgreSQL réel, toutes les migrations, extrait réel de la liste ONU.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const EXCERPT = readFileSync(resolve(process.cwd(), 'apps/api/src/modules/kyc/fixtures/un-consolidated-excerpt.xml'), 'utf8');
const SOURCE = 'https://scsanctions.un.org/resources/xml/en/consolidated.xml';
const CUSTOMER = '019ab700-0000-7000-8000-0000000000c1';

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

async function importList(xml = EXCERPT): Promise<string> {
  const versionId = uuidv7();
  await transact((client) => importUnSanctionsList(client, { versionId, xml, sourceUrl: SOURCE, actorId: 'comp-1' }));
  return versionId;
}

function forgeScreening(client: Client, input: { normalized: string; versionId: string; references: string[]; subject?: string }): Promise<unknown> {
  const outcome = input.references.length === 0 ? 'CLEAR' : 'POTENTIAL_MATCH';
  return client.query(
    `INSERT INTO kyc.screening (id, subject_type, subject_id, normalized_name, version_id, matched_references, outcome, screened_by, screened_at)
     VALUES ($1, 'CUSTOMER', $2, $3, $4, $5, $6, 'kyc-self-declaration', now()) RETURNING id`,
    [uuidv7(), input.subject ?? CUSTOMER, input.normalized, input.versionId, input.references, outcome],
  );
}

async function level(): Promise<string> {
  return (await admin.query<{ kyc_level: string }>('SELECT kyc_level FROM identity.account WHERE id = $1', [CUSTOMER])).rows[0]?.kyc_level ?? '';
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

describe('I-2 REG-LBC-002 filtrage recalculé par la base', () => {
  it('refuse un filtrage « sans rapprochement » falsifié pour un nom listé (KYC_INVALID_REQUEST)', async () => {
    const versionId = await importList();
    const forged = await failure(() => transact((client) => forgeScreening(client, { normalized: 'ERIC BADEGE', versionId, references: [] })));
    expect(forged.message).toMatch(/^KYC_INVALID_REQUEST: références rapprochées différentes du recalcul/);
    const partial = await failure(() => transact((client) => forgeScreening(client, { normalized: 'ERIC BADEGE ALLIED DEMOCRATIC FORCES', versionId, references: ['CDe.001'] })));
    expect(partial.message).toMatch(/^KYC_INVALID_REQUEST: références rapprochées différentes du recalcul/);
  });

  it('accepte un filtrage exact, avec ou sans rapprochement', async () => {
    const versionId = await importList();
    await transact((client) => forgeScreening(client, { normalized: 'QUINCAILLERIE DU CENTRE', versionId, references: [] }));
    await transact((client) => forgeScreening(client, { normalized: 'BADEGE ERIC', versionId, references: ['CDi.001'] }));
    await transact((client) => forgeScreening(client, { normalized: 'ALLIED DEMOCRATIC FORCES', versionId, references: ['CDe.001'] }));
    await transact((client) => forgeScreening(client, { normalized: 'BAL', versionId, references: ['CDe.002'] }));
  });

  it('refuse un filtrage contre une version de liste qui n’est pas la plus récente (KYC_INVALID_REQUEST)', async () => {
    const older = await importList();
    await importList(EXCERPT.replace('dateGenerated="2026-11-17T00:00:02.485Z"', 'dateGenerated="2026-11-18T00:00:02.485Z"'));
    const stale = await failure(() => transact((client) => forgeScreening(client, { normalized: 'QUINCAILLERIE DU CENTRE', versionId: older, references: [] })));
    expect(stale.message).toMatch(/^KYC_INVALID_REQUEST: version de liste qui n'est pas la plus récente/);
  });

  it('refuse de rattacher à une déclaration un filtrage portant un autre nom ; aucun niveau accordé (KYC_INVALID_REQUEST)', async () => {
    const versionId = await importList();
    const result = await failure(() =>
      transact(async (client) => {
        const declaration = uuidv7();
        await client.query(`INSERT INTO identity.legal_name_declaration (id, account_id, legal_name, declared_at) VALUES ($1, $2, 'Eric Badege', now())`, [declaration, CUSTOMER]);
        const screening = await client.query<{ id: string }>(
          `INSERT INTO kyc.screening (id, subject_type, subject_id, normalized_name, version_id, matched_references, outcome, screened_by, screened_at)
           VALUES ($1, 'CUSTOMER', $2, 'QUINCAILLERIE DU CENTRE', $3, '{}', 'CLEAR', 'kyc-self-declaration', now()) RETURNING id`,
          [uuidv7(), CUSTOMER, versionId],
        );
        await client.query('INSERT INTO kyc.legal_name_screening (declaration_id, screening_id) VALUES ($1, $2)', [declaration, screening.rows[0]?.id]);
        await client.query('SELECT kyc.grant_basic_level($1)', [CUSTOMER]);
      }),
    );
    expect(result.message).toMatch(/^KYC_INVALID_REQUEST: le filtrage ne porte pas sur le nom déclaré/);
    expect(await level()).toBe('NONE');
  });

  it('refuse en base une déclaration contenant un caractère invisible ou de format (KYC_INVALID_REQUEST)', async () => {
    for (const name of ['Er​ic Badege', 'Eric⁠Badege', 'Eric Bad­ege', 'Eric‮ Badege', '﻿Eric Badege', 'Eric͏ Badege']) {
      const refused = await failure(() =>
        transact((client) => client.query(`INSERT INTO identity.legal_name_declaration (id, account_id, legal_name, declared_at) VALUES ($1, $2, $3, now())`, [uuidv7(), CUSTOMER, name])),
      );
      expect(refused.message, JSON.stringify(name)).toMatch(/^KYC_INVALID_REQUEST: caractère invisible ou de format/);
    }
  });

  it('parcours applicatif inchangé : nom sans rapprochement → BASIC ; nom listé → en attente', async () => {
    await importList();
    expect(await transact((client) => declareLegalNameAndScreen(client, { accountId: CUSTOMER, legalName: 'Aïcha Ngono Mballa' }))).toMatchObject({ outcome: 'CLEAR', kycLevel: 'BASIC' });
    const other = '019ab700-0000-7000-8000-0000000000c2';
    await seedCustomerAccount(admin, other, 'NONE');
    expect(await transact((client) => declareLegalNameAndScreen(client, { accountId: other, legalName: 'Badège Éric' })))
      .toMatchObject({ outcome: 'POTENTIAL_MATCH', kycLevel: 'SCREENING_PENDING_REVIEW' });
  });

  it('normalisation SQL identique à la normalisation applicative (latin, cyrillique, grec)', async () => {
    const samples: string[] = [];
    const ranges: [number, number][] = [[0x41, 0x5a], [0x61, 0x7a], [0xc0, 0x24f], [0x370, 0x3ff], [0x400, 0x4ff], [0x1e00, 0x1eff]];
    for (const [from, to] of ranges) {
      for (let code = from; code <= to; code += 1) {
        const letter = String.fromCodePoint(code);
        if (!/\p{L}/u.test(letter)) continue;
        samples.push(`Ab${letter}c D-${letter}’e`);
      }
    }
    samples.push('Forces Démocratiques Alliées-Armée', 'l’Ouganda', 'Straße Œuvre ﬁnal', 'Jean  Pierre  N’Diaye', 'ADF (Allied)', 'Еrіc Bаdege');
    const sql = await admin.query<{ i: number; n: string }>('SELECT i::int, kyc.normalize_name(s) AS n FROM unnest($1::text[]) WITH ORDINALITY AS t(s, i)', [samples]);
    const differences = sql.rows.filter((row) => row.n !== normalizeName(samples[row.i - 1] ?? '')).map((row) => ({ input: samples[row.i - 1], sql: row.n, js: normalizeName(samples[row.i - 1] ?? '') }));
    // Seule divergence tolérée : « ƛ » (U+019B) n'a de majuscule (U+A7DC) que depuis Unicode 16, selon l'ICU de la
    // base ; l'écart fait refuser le rattachement (refus visible), jamais accepter un nom non filtré.
    expect(differences.filter((difference) => !(difference.input ?? '').includes('\u019B'))).toEqual([]);
  });
});

describe('I-5 REG-LBC-002 version de liste', () => {
  it('refuse une source hors de l’hôte officiel ONU (KYC_LIST_INVALID)', async () => {
    for (const url of ['https://scsanctions.un.org.evil.example/consolidated.xml', 'https://example.org/resources/xml/en/consolidated.xml', 'https://evil.example/scsanctions.un.org/x.xml']) {
      const refused = await failure(() => transact((client) => importUnSanctionsList(client, { versionId: uuidv7(), xml: EXCERPT, sourceUrl: url, actorId: 'comp-1' })));
      expect(refused.message, url).toMatch(/^KYC_LIST_INVALID: source hors de l'hôte officiel/);
    }
  });

  it('refuse une liste datée du futur, qui deviendrait la référence (KYC_LIST_INVALID)', async () => {
    const future = EXCERPT.replace('dateGenerated="2026-11-17T00:00:02.485Z"', 'dateGenerated="2099-01-01T00:00:00.000Z"');
    const refused = await failure(() => transact((client) => importUnSanctionsList(client, { versionId: uuidv7(), xml: future, sourceUrl: SOURCE, actorId: 'comp-1' })));
    expect(refused.message).toMatch(/^KYC_LIST_INVALID: date de génération dans le futur/);
    expect((await admin.query('SELECT count(*)::int AS n FROM kyc.sanctions_list_version')).rows[0]).toEqual({ n: 0 });
  });
});

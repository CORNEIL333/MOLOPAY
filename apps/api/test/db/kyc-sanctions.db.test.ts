import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getScreeningStatus, recordScreeningReview, screenName } from '../../src/modules/kyc/sanctions.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { asListImporter, importListAsImporter } from './kyc-list-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * REG-LBC-002 / D66 : import versionné de la liste consolidée ONU (extrait
 * réel), filtrage et examen par la conformité, sur PostgreSQL réel avec
 * toutes les migrations.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['crm', 'kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const EXCERPT = readFileSync(resolve(process.cwd(), 'apps/api/src/modules/kyc/fixtures/un-consolidated-excerpt.xml'), 'utf8');
const SOURCE = 'https://scsanctions.un.org/resources/xml/en/consolidated.xml';

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

function importExcerpt(xml = EXCERPT): Promise<{ versionId: string; entryCount: number }> {
  return importListAsImporter(container.getConnectionUri(), { versionId: uuidv7(), xml, sourceUrl: SOURCE, actorId: 'comp-1' });
}

function screen(name: string, subjectId = 'merchant-1', actorId = 'net-1'): ReturnType<typeof screenName> {
  return transact((client) => screenName(client, { screeningId: uuidv7(), subjectType: 'PARTNER', subjectId, name, actorId }));
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
});

describe('REG-LBC-002 import de la liste consolidée ONU', () => {
  it('version et entrées importées en une transaction ; même fichier jamais réimporté', async () => {
    const imported = await importExcerpt();
    expect(imported.entryCount).toBe(5);
    const rows = await admin.query('SELECT count(*)::int AS n FROM kyc.sanctions_entry WHERE version_id = $1', [imported.versionId]);
    expect(rows.rows[0]).toEqual({ n: 5 });
    const names = await admin.query<{ names: string[] }>(`SELECT names FROM kyc.sanctions_entry WHERE reference = 'CDe.001'`);
    expect(names.rows[0]?.names).toContain('Allied Democratic Forces');
    expect((await failure(importExcerpt)).code).toBe('23505');
  });

  it('la base refuse une liste tronquée (nombre annoncé ≠ entrées) et tout ajout après validation', async () => {
    const truncated = await failure(() =>
      asListImporter(container.getConnectionUri(), async (client) => {
        const id = uuidv7();
        await client.query(
          `INSERT INTO kyc.sanctions_list_version (id, source, source_url, generated_at, content_sha256, entry_count, imported_by, imported_at)
           VALUES ($1, 'UN_SC_CONSOLIDATED', $2, now(), $3, 2, 'comp-1', now())`,
          [id, SOURCE, Buffer.alloc(32, 1)],
        );
        await client.query(`INSERT INTO kyc.sanctions_entry (version_id, reference, kind, names) VALUES ($1, 'CDi.001', 'INDIVIDUAL', ARRAY['ERIC BADEGE'])`, [id]);
      }),
    );
    expect(truncated.message).toMatch(/^KYC_LIST_INVALID: 1 entrées importées pour 2 annoncées/);
    const imported = await importExcerpt();
    const late = await failure(() =>
      asListImporter(container.getConnectionUri(), (client) => client.query(`INSERT INTO kyc.sanctions_entry (version_id, reference, kind, names) VALUES ($1, 'CDi.999', 'INDIVIDUAL', ARRAY['X Y'])`, [imported.versionId])),
    );
    expect(late.message).toMatch(/^KYC_APPEND_ONLY: entrée ajoutée à une liste déjà validée/);
  });

  it('liste illisible : refusée sans rien écrire', async () => {
    expect((await failure(() => importExcerpt(EXCERPT.replace('</INDIVIDUALS>', '')))).code).toBe('KYC_LIST_INVALID');
    expect((await admin.query('SELECT count(*)::int AS n FROM kyc.sanctions_list_version')).rows[0]).toEqual({ n: 0 });
  });
});

describe('REG-LBC-002 filtrage et examen (D66)', () => {
  it('sans liste importée : refus explicite, jamais « aucun rapprochement »', async () => {
    expect((await failure(() => screen('Quincaillerie du Centre'))).code).toBe('KYC_LIST_UNAVAILABLE');
  });

  it('rapprochement et absence de rapprochement, figés avec la version de liste et le nom normalisé', async () => {
    const imported = await importExcerpt();
    const match = await screen('Butembo Airlines SARL');
    expect(match).toMatchObject({ outcome: 'POTENTIAL_MATCH', matchedReferences: ['CDe.002'], versionId: imported.versionId });
    const clear = await screen('Quincaillerie du Centre', 'merchant-2');
    expect(clear).toMatchObject({ outcome: 'CLEAR', matchedReferences: [] });
    const stored = await admin.query('SELECT normalized_name, outcome FROM kyc.screening WHERE id = $1', [match.screeningId]);
    expect(stored.rows).toEqual([{ normalized_name: 'BUTEMBO AIRLINES SARL', outcome: 'POTENTIAL_MATCH' }]);
  });

  it('la version la plus récente (date de génération) est utilisée', async () => {
    await importExcerpt();
    const later = EXCERPT.replace('dateGenerated="2026-11-17T00:00:02.485Z"', 'dateGenerated="2026-11-18T00:00:02.485Z"').replace(/ {4}<ENTITY>\s*<DATAID>6908024<\/DATAID>[\s\S]*?<\/ENTITY>\n/, '');
    const newer = await importExcerpt(later);
    expect(newer.entryCount).toBe(4);
    expect(await screen('Butembo Airlines SARL')).toMatchObject({ outcome: 'CLEAR', versionId: newer.versionId });
  });

  it('la base refuse une issue incohérente et une référence absente de la version', async () => {
    const imported = await importExcerpt();
    const insert = (references: string[], outcome: string): Promise<unknown> =>
      transact((client) =>
        client.query(
          `INSERT INTO kyc.screening (id, subject_type, subject_id, normalized_name, version_id, matched_references, outcome, screened_by, screened_at)
           VALUES ($1, 'PARTNER', 'merchant-1', 'X', $2, $3, $4, 'net-1', now())`,
          [uuidv7(), imported.versionId, references, outcome],
        ),
      );
    expect((await failure(() => insert([], 'POTENTIAL_MATCH'))).code).toBe('23514');
    expect((await failure(() => insert(['CDe.002'], 'CLEAR'))).code).toBe('23514');
    expect((await failure(() => insert(['QDi.999'], 'POTENTIAL_MATCH'))).message).toMatch(/^KYC_INVALID_REQUEST: référence rapprochée absente/);
  });

  it('examen : seul un rapprochement, par une autre personne, une seule fois ; état dérivé du dernier filtrage', async () => {
    await importExcerpt();
    const status = (): ReturnType<typeof getScreeningStatus> => transact((client) => getScreeningStatus(client, { subjectType: 'PARTNER', subjectId: 'merchant-1' }));
    expect(await status()).toBe('NOT_SCREENED');
    const clear = await screen('Quincaillerie du Centre');
    expect(await status()).toBe('CLEAR');
    expect((await failure(() => transact((client) => recordScreeningReview(client, { screeningId: clear.screeningId, decision: 'FALSE_POSITIVE', reason: 'x', actorId: 'comp-1' })))).message)
      .toMatch(/^KYC_INVALID_REQUEST: seul un rapprochement/);
    const match = await screen('Butembo Airlines SARL');
    expect(await status()).toBe('PENDING_REVIEW');
    const self = await failure(() => transact((client) => recordScreeningReview(client, { screeningId: match.screeningId, decision: 'FALSE_POSITIVE', reason: 'homonyme', actorId: 'net-1' })));
    expect(self.message).toMatch(/^MAKER_CANNOT_APPROVE/);
    await transact((client) => recordScreeningReview(client, { screeningId: match.screeningId, decision: 'FALSE_POSITIVE', reason: 'société distincte, RCCM vérifié', actorId: 'comp-1' }));
    expect(await status()).toBe('FALSE_POSITIVE');
    expect((await failure(() => transact((client) => recordScreeningReview(client, { screeningId: match.screeningId, decision: 'CONFIRMED_MATCH', reason: 'revu', actorId: 'comp-2' })))).code).toBe('23505');
    const confirmed = await screen('Allied Democratic Forces');
    await transact((client) => recordScreeningReview(client, { screeningId: confirmed.screeningId, decision: 'CONFIRMED_MATCH', reason: 'correspondance avérée', actorId: 'comp-1' }));
    expect(await status()).toBe('CONFIRMED_MATCH');
  });

  it('I-2 tables en ajout seul', async () => {
    await importExcerpt();
    expect((await failure(() => transact((client) => client.query(`UPDATE kyc.sanctions_entry SET names = ARRAY['X']`)))).message).toMatch(/^permission denied/);
    expect((await failure(() => admin.query(`UPDATE kyc.sanctions_entry SET names = ARRAY['X']`))).message).toMatch(/^KYC_APPEND_ONLY/);
    expect((await failure(() => admin.query('DELETE FROM kyc.sanctions_list_version'))).message).toMatch(/^KYC_APPEND_ONLY/);
  });
});

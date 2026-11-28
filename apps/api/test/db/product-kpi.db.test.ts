import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOffer, publishOffer } from '../../src/modules/catalog/domain';
import { appendOfferVersion } from '../../src/modules/catalog/offer.store';
import { computeProductKpis } from '../../src/modules/reporting/kpi.store';
import { createAgreementA } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';
import { runRealFlowsScenario } from './real-flows-scenario';

/**
 * F-REP-002 (tranche 2) : calcul des indicateurs selon
 * `docs/04_annexes/DEFINITIONS_INDICATEURS.md`, en lecture seule (`app_ro`),
 * sur des données produites par les flux réels. Valeurs attendues calculées à
 * la main à partir du scénario : versements 100 000 + 200 000 (objectif C
 * réglé), 50 000 (objectif C annulé puis remboursé), 100 000 + 100 000
 * (achat A, offre TECHNOLOGY à Douala, prix 150 000, commission 250 pb).
 */
let db: TestDatabase;
let admin: Client;
let uri: string;

async function readOnly<T>(action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL ROLE app_ro');
    return await action(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

const ALL_TIME = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2100-01-01T00:00:00Z') };

beforeAll(async () => {
  db = await startTestDatabase();
  uri = db.getConnectionUri();
  admin = new Client({ connectionString: uri });
  await admin.connect();
  await runRealFlowsScenario(uri, admin);
}, 600_000);

afterAll(async () => {
  await admin.end();
  await db.stop();
});

describe('F-REP-002 — indicateurs produits calculés selon les définitions écrites', () => {
  it('totaux exacts sur toute la période (rôle app_ro, lecture seule)', async () => {
    const report = await readOnly((client) => computeProductKpis(client, ALL_TIME));
    expect(report.volume.totalXaf).toBe('550000');
    expect(report.openGoals.total).toBe(0);
    expect(report.completion).toEqual({ activated: 3, funded: 2, ratePercent: '66.7' });
    expect(report.handoverDelay).toMatchObject({ count: 1, medianDays: '0.0', p90Days: '0.0' });
    expect(report.defaultsB).toBe('NOT_APPLICABLE');
    expect(report.commissionMargin).toEqual({ count: 1, totalXaf: '3750', averageXaf: '3750' });
  }, 300_000);

  it('ventilation par univers et par ville : cases attribuées sans supposition, toutes masquées sous 5 objectifs', async () => {
    const report = await readOnly((client) => computeProductKpis(client, ALL_TIME));
    expect(report.volume.byUniverse).toEqual([
      { key: 'PLANNED_EXPENSE_HORS_UNIVERS', goals: '<5', amountXaf: '<5' },
      { key: 'TECHNOLOGY', goals: '<5', amountXaf: '<5' },
    ]);
    expect(report.volume.byCity).toEqual([
      { key: 'NON_ATTRIBUEE', goals: '<5', amountXaf: '<5' },
      { key: 'douala', goals: '<5', amountXaf: '<5' },
    ]);
    expect(report.openGoals.byUniverse).toEqual([]);
    expect(report.openGoals.byCity).toEqual([]);
  }, 300_000);

  it('période : rien avant le scénario ; taux non publié sans objectif activé', async () => {
    const before = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-01-02T00:00:00Z') };
    const report = await readOnly((client) => computeProductKpis(client, before));
    expect(report.volume.totalXaf).toBe('0');
    expect(report.completion).toEqual({ activated: 0, funded: 0, ratePercent: null });
    expect(report.handoverDelay).toEqual({ count: 0, medianDays: null, p90Days: null });
    expect(report.commissionMargin).toEqual({ count: 0, totalXaf: '0', averageXaf: null });
  }, 300_000);

  it('à date : un objectif encore actif à la fin de la période est compté ouvert', async () => {
    // Fin de période juste après le premier versement de l'objectif C réglé : les objectifs C sont encore actifs.
    const firstPayment = (await admin.query<{ at: Date }>('SELECT min(confirmed_at) AS at FROM payments.contribution')).rows[0]?.at ?? new Date();
    const report = await readOnly((client) => computeProductKpis(client, { from: ALL_TIME.from, to: new Date(firstPayment.getTime() + 1) }));
    expect(report.openGoals.total).toBe(3);
    expect(report.volume.totalXaf).toBe('100000');
  }, 300_000);

  it('refuse : période vide ou inversée (REPORT_PERIOD_INVALID)', async () => {
    await expect(readOnly((client) => computeProductKpis(client, { from: ALL_TIME.to, to: ALL_TIME.from }))).rejects.toThrow(/^REPORT_PERIOD_INVALID/);
    await expect(readOnly((client) => computeProductKpis(client, { from: ALL_TIME.from, to: ALL_TIME.from }))).rejects.toThrow(/^REPORT_PERIOD_INVALID/);
  });

  // Dernier test : il ajoute un objectif (les précédents portent sur le scénario seul).
  it('ville : une offre couvrant les deux villes n’est attribuée à aucune (NON_ATTRIBUEE), sans supposition', async () => {
    const offerId = '019aa200-0000-7000-8000-0000000000f2';
    const goalId = '019aa200-0000-7000-8000-0000000000a9';
    await admin.query('BEGIN');
    try {
      await admin.query('SET LOCAL ROLE app_rw');
      await appendOfferVersion(admin, publishOffer(createOffer({
        id: offerId, partner: { id: 'merchant-1', status: 'VALIDATED' }, universe: 'MOBILITY', models: ['SAVE_THEN_BUY'],
        cityIds: ['douala', 'yaounde'], priceXaf: 90_000n, availability: { kind: 'IN_STOCK', units: 2 }, warranty: 'Garantie 6 mois', discountTerms: 'Aucune remise',
      })), 'net-1');
      await createAgreementA(admin, { id: goalId, customerId: '019aa200-0000-7000-8000-0000000000c1', offerId });
      await admin.query('COMMIT');
    } catch (error) {
      await admin.query('ROLLBACK');
      throw error;
    }
    const report = await readOnly((client) => computeProductKpis(client, ALL_TIME));
    expect(report.openGoals.total).toBe(1);
    expect(report.openGoals.byCity).toEqual([{ key: 'NON_ATTRIBUEE', goals: '<5' }]);
    expect(report.openGoals.byUniverse).toEqual([{ key: 'MOBILITY', goals: '<5' }]);
  }, 300_000);
});

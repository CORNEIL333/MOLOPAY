import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { ProductKpisBoard, type ProductKpisPorts } from './product-kpis-board';

const REPORT = {
  period: { from: '2026-10-31T23:00:00.000Z', to: '2026-11-30T23:00:00.000Z' },
  volume: {
    totalXaf: '550000',
    byUniverse: [{ key: 'PLANNED_EXPENSE_HORS_UNIVERS', goals: '<5' as const, amountXaf: '<5' }, { key: 'TECHNOLOGY', goals: 6, amountXaf: '1200000' }],
    byCity: [{ key: 'NON_ATTRIBUEE', goals: '<5' as const, amountXaf: '<5' }, { key: 'douala', goals: 7, amountXaf: '1250000' }],
  },
  openGoals: { total: 12, byUniverse: [{ key: 'HOUSING', goals: 12 }], byCity: [] },
  completion: { activated: 3, funded: 2, ratePercent: '66.7' },
  handoverDelay: { count: 1, medianDays: '2.5', p90Days: '4.0' },
  defaultsB: 'NOT_APPLICABLE' as const,
  commissionMargin: { count: 1, totalXaf: '3750', averageXaf: '3750' },
};

function ports(overrides: Partial<ProductKpisPorts> = {}): ProductKpisPorts {
  return { load: vi.fn<ProductKpisPorts['load']>(() => Promise.resolve({ ok: true, report: REPORT })), ...overrides };
}

async function open(injected: ProductKpisPorts, values: { from?: string; to?: string; reason?: string } = {}): Promise<void> {
  const user = userEvent.setup();
  render(<ProductKpisBoard ports={injected} />);
  await user.type(screen.getByLabelText('Premier jour (inclus)'), values.from ?? '2026-11-01');
  await user.type(screen.getByLabelText('Jour de fin (exclu)'), values.to ?? '2026-12-01');
  await user.type(screen.getByLabelText('Motif de la consultation'), values.reason ?? 'revue mensuelle');
  await user.click(screen.getByRole('button', { name: 'Afficher les indicateurs' }));
}

describe('F-REP-002 — indicateurs produits au back-office', () => {
  it('appel avec la période et le motif ; totaux, taux, délais, marge ; impayés B « sans objet »', async () => {
    const injected = ports();
    await open(injected);
    expect(injected.load).toHaveBeenCalledWith({ from: '2026-11-01', to: '2026-12-01', reason: 'revue mensuelle' });
    const totals = await screen.findByRole('list', { name: 'Totaux de la période' });
    expect(totals).toHaveTextContent(/Volume confirmé\s*:\s*550\s000\sFCFA/);
    expect(totals).toHaveTextContent('Objectifs ouverts à la fin de la période : 12');
    expect(totals).toHaveTextContent('Objectifs à 100 % : 66,7 % (2 sur 3 activés)');
    expect(totals).toHaveTextContent('Délai de remise : médiane 2,5 j, 90ᵉ centile 4,0 j (1 remise)');
    expect(totals).toHaveTextContent(/Marge de commission\s*:\s*3\s750\sFCFA sur 1 commande, moyenne 3\s750\sFCFA/);
    expect(totals).toHaveTextContent('Impayés B : sans objet (modèle B non ouvert)');
  });

  it('ventilations : libellés français, cases de moins de 5 objectifs affichées « moins de 5 », sans montant', async () => {
    await open(ports());
    const universes = await screen.findByRole('table', { name: 'Volume par univers' });
    const rows = within(universes).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Dépense planifiée (hors univers)');
    expect(rows[1]).toHaveTextContent('moins de 5');
    expect(rows[1]).not.toHaveTextContent('FCFA');
    expect(rows[2]).toHaveTextContent('Technologie');
    expect(rows[2]).toHaveTextContent(/1\s200\s000\sFCFA/);
    const cities = screen.getByRole('table', { name: 'Volume par ville' });
    expect(within(cities).getAllByRole('row')[1]).toHaveTextContent('Non attribuée');
    expect(within(cities).getAllByRole('row')[2]).toHaveTextContent('Douala');
    expect(screen.getByText('Aucun objectif ouvert attribuable à une ville.')).toBeVisible();
  });

  it('refuse avant tout appel : motif trop court, dates absentes, période inversée ou de plus de 366 jours', async () => {
    for (const values of [
      { reason: 'ab' },
      { from: '2026-12-01', to: '2026-11-01' },
      { from: '2026-11-01', to: '2026-11-01' },
      { from: '2024-01-01', to: '2025-01-02' },
    ]) {
      const injected = ports();
      await open(injected, values);
      expect(injected.load, JSON.stringify(values)).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toBeVisible();
      document.body.innerHTML = '';
    }
  });

  it('erreur du serveur (refus de rôle) affichée sans indicateurs ; accessibilité', async () => {
    const injected = ports({ load: vi.fn<ProductKpisPorts['load']>(() => Promise.resolve({ ok: false, problem: { title: 'Action interdite', detail: 'Rôle non autorisé' } })) });
    await open(injected);
    expect(await screen.findByText('Action interdite')).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Totaux de la période' })).toBeNull();
    await expectNoA11yViolations(document.body);
  });

  it('un refus après un premier affichage efface les indicateurs précédents (aucun chiffre périmé)', async () => {
    const load = vi.fn<ProductKpisPorts['load']>()
      .mockResolvedValueOnce({ ok: true, report: REPORT })
      .mockResolvedValueOnce({ ok: false, problem: { title: 'Période refusée', detail: 'REPORT_PERIOD_INVALID' } });
    const user = userEvent.setup();
    await open({ load });
    expect(await screen.findByRole('list', { name: 'Totaux de la période' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Afficher les indicateurs' }));
    expect(await screen.findByText('Période refusée')).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Totaux de la période' })).toBeNull();
  });
});

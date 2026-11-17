import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { DashboardBoard, type DashboardPorts } from './dashboard-board';

const BOARD = {
  asOf: '2026-11-17T10:00:00.000Z',
  agreements: [
    { model: 'PLANNED_EXPENSE' as const, universe: null, cities: '', status: 'DISPUTED', count: 1, targetXaf: '300000', confirmedFundsXaf: '20000' },
    { model: 'SAVE_THEN_BUY' as const, universe: 'TECHNOLOGY' as const, cities: 'douala+yaounde', status: 'HANDED_OVER', count: 3, targetXaf: '450000', confirmedFundsXaf: '450000' },
  ],
  settlements: [{ state: 'EXECUTED' as const, count: 1, netXaf: '146250' }],
  handovers: 3,
  openDisputes: 1,
  openComplaints: 2,
  openRiskAlerts: 4,
};

function ports(overrides: Partial<DashboardPorts> = {}): DashboardPorts {
  return { load: vi.fn<DashboardPorts['load']>(() => Promise.resolve({ ok: true, board: BOARD })), ...overrides };
}

async function open(injected: DashboardPorts, reason = 'pilotage hebdomadaire'): Promise<void> {
  const user = userEvent.setup();
  render(<DashboardBoard ports={injected} />);
  await user.type(screen.getByLabelText('Motif de la consultation'), reason);
  await user.click(screen.getByRole('button', { name: 'Afficher le tableau de bord' }));
}

describe('F-BO-003 / D65 tableau de bord du back-office', () => {
  it('motif obligatoire (3 caractères) : aucun appel sinon', async () => {
    const injected = ports();
    await open(injected, 'ab');
    expect(screen.getByText(/motif/i, { selector: '.achat-field__error' })).toBeVisible();
    expect(injected.load).not.toHaveBeenCalled();
  });

  it('accords par modèle, univers, villes et état ; montants FCFA ; compteurs', async () => {
    const injected = ports();
    await open(injected);
    expect(injected.load).toHaveBeenCalledWith('pilotage hebdomadaire');
    const table = await screen.findByRole('table', { name: 'Accords' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Dépense planifiée');
    expect(rows[1]).toHaveTextContent('—');
    expect(rows[1]).toHaveTextContent(/20\s000\sFCFA/);
    expect(rows[2]).toHaveTextContent('Épargne puis achat');
    expect(rows[2]).toHaveTextContent('Technologie');
    expect(rows[2]).toHaveTextContent('Douala, Yaoundé');
    expect(within(rows[2] as HTMLElement).getAllByRole('cell')[4]).toHaveTextContent(/^3$/);
    const settlements = screen.getByRole('table', { name: 'Règlements marchands' });
    expect(within(settlements).getAllByRole('row')[1]).toHaveTextContent(/Exécuté1146\s250\sFCFA/);
    const counters = screen.getByRole('list', { name: 'Compteurs' });
    expect(counters).toHaveTextContent('Remises : 3');
    expect(counters).toHaveTextContent('Litiges ouverts : 1');
    expect(counters).toHaveTextContent('Réclamations ouvertes : 2');
    expect(counters).toHaveTextContent('Alertes de fraude ouvertes : 4');
  });

  it('refus du serveur affiché', async () => {
    await open(ports({ load: () => Promise.resolve({ ok: false, problem: { title: 'Action interdite', status: 403 } }) }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Action interdite'); });
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('un nouvel échec efface l’instantané précédent (jamais de chiffres périmés)', async () => {
    const load = vi.fn<DashboardPorts['load']>()
      .mockResolvedValueOnce({ ok: true, board: BOARD })
      .mockResolvedValueOnce({ ok: false, problem: { title: 'Authentification requise', status: 401 } });
    const user = userEvent.setup();
    render(<DashboardBoard ports={{ load }} />);
    await user.type(screen.getByLabelText('Motif de la consultation'), 'pilotage');
    await user.click(screen.getByRole('button', { name: 'Afficher le tableau de bord' }));
    await screen.findByRole('table', { name: 'Accords' });
    await user.click(screen.getByRole('button', { name: 'Afficher le tableau de bord' }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Authentification requise'); });
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('structure accessible', async () => {
    const injected = ports();
    await open(injected);
    await screen.findByRole('table', { name: 'Accords' });
    await expectNoA11yViolations(document.body);
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { GoalHistory, type GoalHistoryPorts } from './goal-history';

const ID = '019ab840-0000-7000-8000-0000000000a1';
const HISTORY = {
  goalId: ID,
  items: [
    { at: '2026-11-10T09:00:00.000Z', kind: 'AGREEMENT_STATUS', from: 'DRAFT', to: 'ACTIVE' },
    { at: '2026-11-11T09:00:00.000Z', kind: 'PAYMENT_ATTEMPT', attemptId: '019ab840-0000-7000-8000-0000000000b1', channel: 'MOMO', amountXaf: '25000' },
    { at: '2026-11-12T09:00:00.000Z', kind: 'DISPUTE_OPENED', disputeId: '019ab840-0000-7000-8000-0000000000d1' },
  ],
};

function ports(overrides: Partial<GoalHistoryPorts> = {}): GoalHistoryPorts {
  return { load: vi.fn<GoalHistoryPorts['load']>(() => Promise.resolve({ ok: true, history: HISTORY })), ...overrides };
}

async function open(injected: GoalHistoryPorts, id = ID, reason = 'appel du client'): Promise<void> {
  const user = userEvent.setup();
  render(<GoalHistory ports={injected} />);
  await user.type(screen.getByLabelText('Identifiant de l’objectif'), id);
  await user.type(screen.getByLabelText('Motif de la consultation'), reason);
  await user.click(screen.getByRole('button', { name: 'Consulter l’historique' }));
}

describe('C6 / F-SUP-003 historique d’un objectif au back-office', () => {
  it('identifiant ou motif invalide : aucun appel', async () => {
    const injected = ports();
    await open(injected, 'pas-un-uuid', 'ab');
    expect(screen.getByText(/Identifiant invalide/)).toBeVisible();
    expect(screen.getByText(/motif de la consultation/i, { selector: 'p, span' })).toBeVisible();
    expect(injected.load).not.toHaveBeenCalled();
  });

  it('consultation motivée : événements datés, libellés en français, montant entier en FCFA', async () => {
    const injected = ports();
    await open(injected);
    await waitFor(() => { expect(injected.load).toHaveBeenCalledWith(ID, 'appel du client'); });
    const list = await screen.findByRole('list', { name: 'Événements de l’objectif' });
    expect(list).toHaveTextContent('Changement de statut');
    expect(list).toHaveTextContent('DRAFT → ACTIVE');
    expect(list).toHaveTextContent('Tentative de versement');
    expect(list).toHaveTextContent(/25\s000\sFCFA/);
    expect(list).toHaveTextContent('Litige ouvert');
  });

  it('identifiant prérempli depuis la file ou la réclamation ; refus du serveur affiché', async () => {
    const user = userEvent.setup();
    render(<GoalHistory ports={ports({ load: () => Promise.resolve({ ok: false, problem: { title: 'Action interdite', status: 403 } }) })} initialGoalId={ID} />);
    expect(screen.getByLabelText('Identifiant de l’objectif')).toHaveValue(ID);
    await user.type(screen.getByLabelText('Motif de la consultation'), 'contrôle');
    await user.click(screen.getByRole('button', { name: 'Consulter l’historique' }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Action interdite'); });
  });

  it('structure accessible', async () => {
    await open(ports());
    await screen.findByRole('list', { name: 'Événements de l’objectif' });
    await expectNoA11yViolations(document.body);
  });
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { CrmCustomer360 } from './crm-customer-360';
import type { CrmFile, CrmPorts } from './crm-ports';

const ID = '019abe20-0000-7000-8000-0000000000c1';
const TASK = '019abe20-0000-7000-8000-000000000201';

const FILE: CrmFile = {
  accountId: ID,
  phoneMasked: '+237••••••00',
  memberSince: '2026-01-05T10:00:00.000Z',
  legalNameDeclared: true,
  agreements: [{ agreementId: '019abe20-0000-7000-8000-0000000000a1', model: 'SAVE_THEN_BUY', status: 'ACTIVE', targetXaf: '250000' }],
  interactions: [{
    interactionId: '019abe20-0000-7000-8000-000000000101',
    channel: 'PHONE',
    direction: 'INBOUND',
    summary: 'Client : versement annoncé non reçu',
    outcome: null,
    actorId: 'sup.un',
    occurredAt: '2026-11-19T09:00:00.000Z',
  }],
  tasks: [{
    taskId: TASK,
    title: 'Rappeler le client',
    details: 'Versement annoncé non reçu',
    priority: 'HIGH',
    assigneeId: 'sup.deux',
    dueAt: '2026-11-21T09:00:00.000Z',
    status: 'OPEN',
  }],
};

function ports(overrides: Partial<CrmPorts> = {}): CrmPorts {
  return {
    file: vi.fn<CrmPorts['file']>(() => Promise.resolve({ ok: true, value: FILE })),
    recordInteraction: vi.fn<CrmPorts['recordInteraction']>(() => Promise.resolve({ ok: true, value: null })),
    createTask: vi.fn<CrmPorts['createTask']>(() => Promise.resolve({ ok: true, value: null })),
    transitionTask: vi.fn<CrmPorts['transitionTask']>(() => Promise.resolve({ ok: true, value: null })),
    ...overrides,
  };
}

async function openFile(injected: CrmPorts): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<CrmCustomer360 ports={injected} />);
  await user.type(screen.getByLabelText('Identifiant du compte client'), ID);
  await user.type(screen.getByLabelText('Motif de la consultation'), 'Réclamation client, vérification du dossier');
  await user.click(screen.getByRole('button', { name: 'Ouvrir la fiche' }));
  await screen.findByRole('heading', { name: 'Identité' });
  return user;
}

describe('Q5 / F-SUP-001 fiche client 360° du support', () => {
  it('identifiant ou motif invalide : aucun appel', async () => {
    const injected = ports();
    const user = userEvent.setup();
    render(<CrmCustomer360 ports={injected} />);
    await user.type(screen.getByLabelText('Identifiant du compte client'), 'pas-un-uuid');
    await user.type(screen.getByLabelText('Motif de la consultation'), 'ab');
    await user.click(screen.getByRole('button', { name: 'Ouvrir la fiche' }));
    expect(screen.getByText(/Identifiant de compte invalide/)).toBeVisible();
    expect(screen.getByText(/motif de consultation est obligatoire/)).toBeVisible();
    expect(injected.file).not.toHaveBeenCalled();
  });

  it('fiche : numéro masqué, nom déclaré, accord, échange et tâche ; forme accessible', async () => {
    const injected = ports();
    await openFile(injected);
    expect(injected.file).toHaveBeenCalledWith(ID, 'Réclamation client, vérification du dossier');
    const identity = screen.getByRole('region', { name: 'Identité' });
    expect(identity).toHaveTextContent('+237••••••00');
    expect(identity).toHaveTextContent('Nom déclaré');
    const agreements = screen.getByRole('region', { name: 'Accords récents' });
    expect(agreements).toHaveTextContent(/250\s000\sFCFA/u);
    const journal = screen.getByRole('region', { name: 'Journal des échanges' });
    expect(journal).toHaveTextContent('Client : versement annoncé non reçu');
    expect(screen.getByRole('heading', { name: 'Rappeler le client' })).toBeVisible();
    await expectNoA11yViolations(document.body);
  });

  it('consigner un échange : appel réel puis relecture de la fiche', async () => {
    const injected = ports();
    const user = await openFile(injected);
    await user.type(screen.getByLabelText('Résumé de l’échange'), 'Appel : reçu transmis');
    await user.click(screen.getByRole('button', { name: 'Consigner l’échange' }));
    await waitFor(() => {
      expect(injected.recordInteraction).toHaveBeenCalledWith(ID, expect.objectContaining({
        channel: 'PHONE', direction: 'INBOUND', summary: 'Appel : reçu transmis', outcome: null, occurredAt: expect.any(String) as unknown,
      }));
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Échange consigné');
    await waitFor(() => { expect(injected.file).toHaveBeenCalledTimes(2); });
  });

  it('tâche ouverte : clôture motivée, la tâche close n’offre plus de transition', async () => {
    const injected = ports({
      file: vi.fn<CrmPorts['file']>()
        .mockResolvedValueOnce({ ok: true, value: FILE })
        .mockResolvedValue({ ok: true, value: { ...FILE, tasks: [{ ...FILE.tasks[0]!, status: 'COMPLETED' }] } }),
    });
    const user = await openFile(injected);
    const task = screen.getByRole('article', { name: 'Rappeler le client' });
    await user.type(within(task).getByLabelText('Motif de clôture'), 'Client rappelé, versement retrouvé');
    await user.click(within(task).getByRole('button', { name: 'Terminer la tâche' }));
    await waitFor(() => { expect(injected.transitionTask).toHaveBeenCalledWith(TASK, 'COMPLETED', 'Client rappelé, versement retrouvé'); });
    await waitFor(() => { expect(screen.getByRole('article', { name: 'Rappeler le client' })).toHaveTextContent('Terminée'); });
    expect(screen.queryByRole('button', { name: 'Terminer la tâche' })).toBeNull();
  });

  it('refus du serveur : le problème est affiché, rien n’est inventé', async () => {
    const injected = ports({
      file: vi.fn<CrmPorts['file']>(() => Promise.resolve({ ok: false, problem: { title: 'Action interdite', detail: 'Rôle insuffisant pour READ_FINANCIAL_HISTORY', status: 403 } })),
    });
    const user = userEvent.setup();
    render(<CrmCustomer360 ports={injected} />);
    await user.type(screen.getByLabelText('Identifiant du compte client'), ID);
    await user.type(screen.getByLabelText('Motif de la consultation'), 'Réclamation client');
    await user.click(screen.getByRole('button', { name: 'Ouvrir la fiche' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Rôle insuffisant');
    expect(screen.queryByRole('heading', { name: 'Identité' })).toBeNull();
  });
});

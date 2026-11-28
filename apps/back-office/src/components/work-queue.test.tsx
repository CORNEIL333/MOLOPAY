import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { components } from '@achat/contracts/api';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { WorkQueue, type WorkQueuePorts } from './work-queue';

type Queue = components['schemas']['BackofficeQueue'];
const QUEUE: Queue = {
  asOf: '2026-11-12T10:00:00.000Z',
  refunds: [{ refundId: '019aa800-0000-7000-8000-0000000000r1', kind: 'CANCELLATION', amountXaf: '50000', stage: 'AWAITING_DECISION', preparedBy: 'ops.un' }],
  beneficiaryPayouts: [],
  settlements: [],
  overdueInstructions: [],
  gapsToEscalate: [],
  unjustifiedSuspense: [],
  openRiskAlerts: [{ alertId: '019aa800-0000-7000-8000-0000000000a1', rule: 'PAYMENT_VELOCITY', subjectType: 'CUSTOMER', detectedAt: '2026-11-12T09:00:00.000Z' }],
  overdueComplaints: [{ complaintId: '019aa800-0000-7000-8000-0000000000c9', reference: 'R-0123456789', beyondMaximum: false }],
  pendingSanctionsReviews: [{ screeningId: '019aa800-0000-7000-8000-0000000000s1', subjectType: 'CUSTOMER', screenedAt: '2026-11-12T08:00:00.000Z' }],
  pendingGapClassifications: [{ proposalId: '019aa800-0000-7000-8000-0000000000p1', incidentId: '019aa800-0000-7000-8000-0000000000i1', classification: 'FEES', proposedBy: 'fin.un', proposedAt: '2026-11-12T08:30:00.000Z' }],
  openDisputes: [{ disputeId: '019aa800-0000-7000-8000-0000000000d1', agreementId: '019aa800-0000-7000-8000-0000000000g1', openedBy: 'sup.deux', openedAt: '2026-11-12T08:45:00.000Z' }],
};

describe('F-BO-003 / F-BO-004 file de travail du back-office', () => {
  it('exige un motif de consultation avant toute lecture', async () => {
    const user = userEvent.setup();
    const loadQueue = vi.fn<WorkQueuePorts['loadQueue']>(() => Promise.resolve({ ok: true, queue: QUEUE }));
    render(<WorkQueue ports={{ loadQueue }} />);
    await user.click(screen.getByRole('button', { name: 'Afficher la file' }));
    expect(screen.getByText(/Motif obligatoire/)).toBeVisible();
    expect(loadQueue).not.toHaveBeenCalled();
  });

  it('affiche les sections avec leur nombre et les éléments en attente', async () => {
    const user = userEvent.setup();
    const loadQueue = vi.fn<WorkQueuePorts['loadQueue']>(() => Promise.resolve({ ok: true, queue: QUEUE }));
    const { container } = render(<WorkQueue ports={{ loadQueue }} />);
    await user.type(screen.getByLabelText('Motif de consultation'), 'revue quotidienne');
    await user.click(screen.getByRole('button', { name: 'Afficher la file' }));
    await waitFor(() => { expect(screen.getByRole('heading', { name: 'Remboursements (1)' })).toBeVisible(); });
    expect(loadQueue).toHaveBeenCalledWith('revue quotidienne');
    expect(screen.getByRole('heading', { name: 'Alertes de fraude ouvertes (1)' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Rapprochements sanctions à examiner (1)' })).toBeVisible();
    expect(screen.getByText(/019aa800-0000-7000-8000-0000000000s1/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Examiner le rapprochement 019aa800-0000-7000-8000-0000000000s1' })).toHaveAttribute('href', '/conformite?filtrage=019aa800-0000-7000-8000-0000000000s1');
    expect(screen.getByRole('link', { name: 'Consulter la réclamation R-0123456789' })).toHaveAttribute('href', '/reclamations?reclamation=019aa800-0000-7000-8000-0000000000c9');
    expect(screen.getByRole('heading', { name: 'Virements aux bénéficiaires (0)' })).toBeVisible();
    expect(screen.getByText('En attente de décision')).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('session expirée (401) : invite à se reconnecter', async () => {
    const user = userEvent.setup();
    const loadQueue = vi.fn<WorkQueuePorts['loadQueue']>(() => Promise.resolve({ ok: false, problem: { title: 'Authentification requise', status: 401 } }));
    render(<WorkQueue ports={{ loadQueue }} />);
    await user.type(screen.getByLabelText('Motif de consultation'), 'revue');
    await user.click(screen.getByRole('button', { name: 'Afficher la file' }));
    await waitFor(() => { expect(screen.getByRole('link', { name: 'Se reconnecter' })).toHaveAttribute('href', '/'); });
  });

  it('les éléments en attente portent leur action, et la file est relue après une action', async () => {
    const user = userEvent.setup();
    const loadQueue = vi.fn<WorkQueuePorts['loadQueue']>(() => Promise.resolve({ ok: true, queue: QUEUE }));
    const act = vi.fn<NonNullable<WorkQueuePorts['act']>>(() => Promise.resolve({ ok: true }));
    render(<WorkQueue ports={{ loadQueue, act }} />);
    await user.type(screen.getByLabelText('Motif de consultation'), 'revue');
    await user.click(screen.getByRole('button', { name: 'Afficher la file' }));
    await user.click(await screen.findByRole('button', { name: 'Approuver' }));
    await waitFor(() => { expect(loadQueue).toHaveBeenCalledTimes(2); });
    expect(act).toHaveBeenCalledWith({ flow: 'refunds', id: QUEUE.refunds[0]!['refundId'], step: 'decision', body: { decision: 'APPROVED' } });
  });

  it('affiche le problème renvoyé (droit de lecture absent)', async () => {
    const user = userEvent.setup();
    const loadQueue = vi.fn<WorkQueuePorts['loadQueue']>(() => Promise.resolve({ ok: false, problem: { title: 'Action interdite', detail: 'Action non autorisée' } }));
    render(<WorkQueue ports={{ loadQueue }} />);
    await user.type(screen.getByLabelText('Motif de consultation'), 'revue');
    await user.click(screen.getByRole('button', { name: 'Afficher la file' }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Action interdite'); });
  });

  it('C6 décisions d’une seconde personne : classe à valider et litige à lever, avec lien vers l’historique de l’objectif', async () => {
    const user = userEvent.setup();
    const loadQueue = vi.fn<WorkQueuePorts['loadQueue']>(() => Promise.resolve({ ok: true, queue: QUEUE }));
    const oversee = vi.fn<NonNullable<WorkQueuePorts['oversee']>>(() => Promise.resolve({ ok: true }));
    render(<WorkQueue ports={{ loadQueue, oversee }} />);
    await user.type(screen.getByLabelText('Motif de consultation'), 'revue quotidienne');
    await user.click(screen.getByRole('button', { name: 'Afficher la file' }));
    const gaps = await screen.findByRole('region', { name: /^Classes d’écarts à valider/ });
    expect(gaps).toHaveTextContent('fin.un');
    const disputes = screen.getByRole('region', { name: /^Litiges ouverts à lever/ });
    expect(disputes).toHaveTextContent('sup.deux');
    expect(screen.getByRole('link', { name: 'Historique de l’objectif 019aa800-0000-7000-8000-0000000000g1' })).toHaveAttribute('href', '/objectifs?objectif=019aa800-0000-7000-8000-0000000000g1');
    await user.click(screen.getByRole('button', { name: 'Lever le litige' }));
    await waitFor(() => { expect(oversee).toHaveBeenCalledWith({ path: '/v1/backoffice/disputes/019aa800-0000-7000-8000-0000000000d1/resolution', body: {} }); });
  });
});


import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { ComplaintDetail, type ComplaintPorts } from './complaint-detail';

const ID = '019ab800-0000-7000-8000-0000000000e1';
const DETAIL = {
  complaintId: ID, reference: 'R-0123456789', agreementId: '019ab800-0000-7000-8000-0000000000a1', channel: 'APP' as const,
  receivedAt: '2026-11-17T10:00:00.000Z', reason: 'PAYMENT_NOT_RECEIVED' as const, details: 'Mon versement du 3 novembre n’apparaît pas.', closed: false, openDispute: true,
};

function ports(overrides: Partial<ComplaintPorts> = {}): ComplaintPorts {
  return {
    load: vi.fn<ComplaintPorts['load']>(() => Promise.resolve({ ok: true, complaint: DETAIL })),
    openDispute: vi.fn<ComplaintPorts['openDispute']>(() => Promise.resolve({ ok: true, disputeId: '019ab800-0000-7000-8000-0000000000d1' })),
    ...overrides,
  };
}

async function open(injected: ComplaintPorts, id = ID, reason = 'appel du client'): Promise<void> {
  const user = userEvent.setup();
  render(<ComplaintDetail ports={injected} />);
  await user.type(screen.getByLabelText('Identifiant de la réclamation'), id);
  await user.type(screen.getByLabelText('Motif de la consultation'), reason);
  await user.click(screen.getByRole('button', { name: 'Consulter' }));
}

describe('F-SUP-001 / D73 détail d’une réclamation au back-office', () => {
  it('identifiant ou motif invalide : aucun appel', async () => {
    const injected = ports();
    await open(injected, 'pas-un-uuid', 'ab');
    expect(screen.getByText(/Identifiant invalide/)).toBeVisible();
    expect(injected.load).not.toHaveBeenCalled();
  });

  it('identifiant valide mais motif trop court : aucun appel', async () => {
    const injected = ports();
    await open(injected, ID, 'ab');
    expect(screen.getByText(/motif de la consultation \(3 caractères/)).toBeVisible();
    expect(injected.load).not.toHaveBeenCalled();
  });

  it('détail affiché : numéro, canal, motif lisible, description, litige ouvert', async () => {
    const injected = ports();
    await open(injected);
    expect(injected.load).toHaveBeenCalledWith(ID, 'appel du client');
    const details = await screen.findByRole('region', { name: 'Réclamation R-0123456789' });
    expect(details).toHaveTextContent('Application');
    expect(details).toHaveTextContent('Versement non reçu');
    expect(details).toHaveTextContent('Mon versement du 3 novembre n’apparaît pas.');
    expect(details).toHaveTextContent('Litige ouvert : oui');
    expect(details).toHaveTextContent('Close : non');
  });

  it('réclamation téléphonique sans détail : mention explicite', async () => {
    await open(ports({ load: () => Promise.resolve({ ok: true, complaint: { ...DETAIL, channel: 'PHONE', reason: null, details: null, agreementId: null } }) }));
    expect(await screen.findByRole('region', { name: 'Réclamation R-0123456789' })).toHaveTextContent('Aucune description saisie');
  });

  it('refus du serveur affiché', async () => {
    await open(ports({ load: () => Promise.resolve({ ok: false, problem: { title: 'Ressource introuvable', status: 404 } }) }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Ressource introuvable'); });
  });

  it('structure accessible', async () => {
    await open(ports());
    await screen.findByRole('region', { name: 'Réclamation R-0123456789' });
    await expectNoA11yViolations(document.body);
  });

  it('identifiant prérempli depuis la file (paramètre d’URL)', () => {
    render(<ComplaintDetail ports={ports()} initialComplaintId="019aa800-0000-7000-8000-0000000000e1" />);
    expect(screen.getByLabelText('Identifiant de la réclamation')).toHaveValue('019aa800-0000-7000-8000-0000000000e1');
  });

  it('C6 / D56 litige : proposé seulement si la réclamation n’est ni close ni déjà en litige ; ouvert puis affiché', async () => {
    const injected = ports({ load: vi.fn<ComplaintPorts['load']>(() => Promise.resolve({ ok: true, complaint: { ...DETAIL, openDispute: false } })) });
    await open(injected);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ouvrir un litige' }));
    await waitFor(() => { expect(injected.openDispute).toHaveBeenCalledWith(ID); });
    expect(await screen.findByText(/Litige ouvert : oui/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Ouvrir un litige' })).toBeNull();
    expect(screen.getByRole('link', { name: /Historique de l’objectif/ })).toHaveAttribute('href', `/objectifs?objectif=${DETAIL.agreementId}`);
  });

  it('C6 litige déjà ouvert ou réclamation close : aucune ouverture proposée', async () => {
    await open(ports());
    await screen.findByText(/Litige ouvert : oui/);
    expect(screen.queryByRole('button', { name: 'Ouvrir un litige' })).toBeNull();
  });
});


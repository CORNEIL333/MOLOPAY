import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { OrdersBoard, PayoutsBoard, type BoardPorts, type PartnerOrderRow, type PartnerPayoutRow } from './partner-boards';

const ORDER: PartnerOrderRow = {
  orderId: '019ab100-0000-7000-8000-0000000000a1',
  offerId: '019ab100-0000-7000-8000-0000000000f1',
  offerTitle: 'Réfrigérateur 200 L',
  status: 'FUNDED',
  targetXaf: '150000',
  progressBasisPoints: 10000,
  createdAt: '2026-11-01T09:00:00.000Z',
  handedOverAt: null,
};
const PAYOUT: PartnerPayoutRow = {
  payoutId: '019ab100-0000-7000-8000-0000000000b1',
  agreementId: ORDER.orderId,
  grossXaf: '150000',
  commissionXaf: '3750',
  netXaf: '146250',
  status: 'EXECUTED',
  executedAt: '2026-11-03T09:00:00.000Z',
  bankReference: 'ETAB-REG-1',
};

function ports(overrides: Partial<BoardPorts> = {}): BoardPorts {
  return {
    loadOrders: vi.fn<BoardPorts['loadOrders']>(() => Promise.resolve({ ok: true, rows: [ORDER] })),
    loadPayouts: vi.fn<BoardPorts['loadPayouts']>(() => Promise.resolve({ ok: true, rows: [PAYOUT] })),
    ...overrides,
  };
}

describe('F-PRT-004 / D63 tableau des commandes', () => {
  it('commandes listées : offre, état lisible, montant FCFA, progression ; aucune donnée client', async () => {
    render(<OrdersBoard ports={ports()} role="SELLER" />);
    const table = await screen.findByRole('table', { name: 'Commandes' });
    const row = within(table).getAllByRole('row')[1];
    expect(row).toHaveTextContent('Réfrigérateur 200 L');
    expect(row).toHaveTextContent('Financée à 100 %');
    expect(row).toHaveTextContent(/150\s000\sFCFA/);
    expect(row).toHaveTextContent('100 %');
  });

  it('progression partielle arrondie au pour cent inférieur', async () => {
    render(<OrdersBoard ports={ports({ loadOrders: () => Promise.resolve({ ok: true, rows: [{ ...ORDER, status: 'ACTIVE', progressBasisPoints: 4299 }] }) })} role="SELLER" />);
    const table = await screen.findByRole('table', { name: 'Commandes' });
    const cells = within(within(table).getAllByRole('row')[1] as HTMLElement).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent(/^42 %$/);
  });

  it('export CSV proposé au gérant seulement', async () => {
    const { unmount } = render(<OrdersBoard ports={ports()} role="MANAGER" />);
    expect(await screen.findByRole('link', { name: 'Exporter les commandes (CSV)' })).toHaveAttribute('href', '/v1/partner/orders/export');
    unmount();
    render(<OrdersBoard ports={ports()} role="SELLER" />);
    await screen.findByRole('table', { name: 'Commandes' });
    expect(screen.queryByRole('link', { name: /Exporter/ })).toBeNull();
  });

  it('aucune commande : état vide ; erreur : problème affiché', async () => {
    const { unmount } = render(<OrdersBoard ports={ports({ loadOrders: () => Promise.resolve({ ok: true, rows: [] }) })} role="SELLER" />);
    expect(await screen.findByText('Aucune commande pour le moment.')).toBeVisible();
    unmount();
    render(<OrdersBoard ports={ports({ loadOrders: () => Promise.resolve({ ok: false, problem: { title: 'Authentification requise', status: 401 } }) })} role="SELLER" />);
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Authentification requise'); });
  });

  it('structure accessible', async () => {
    const { container } = render(<OrdersBoard ports={ports()} role="MANAGER" />);
    await screen.findByRole('table', { name: 'Commandes' });
    await expectNoA11yViolations(container);
  });
});

describe('F-PRT-003/004 / D63 règlements (gérant)', () => {
  it('brut, commission, net en FCFA, état et référence d’exécution', async () => {
    render(<PayoutsBoard ports={ports()} />);
    const table = await screen.findByRole('table', { name: 'Règlements' });
    const row = within(table).getAllByRole('row')[1];
    expect(row).toHaveTextContent(/150\s000\sFCFA/);
    expect(row).toHaveTextContent(/3\s750\sFCFA/);
    expect(row).toHaveTextContent(/146\s250\sFCFA/);
    expect(row).toHaveTextContent('Payé');
    expect(row).toHaveTextContent('ETAB-REG-1');
  });

  it('vendeur refusé par le serveur (403) : message, aucun tableau', async () => {
    render(<PayoutsBoard ports={ports({ loadPayouts: () => Promise.resolve({ ok: false, problem: { title: 'Action interdite', status: 403 } }) })} />);
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Action interdite'); });
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('structure accessible', async () => {
    const { container } = render(<PayoutsBoard ports={ports()} />);
    await screen.findByRole('table', { name: 'Règlements' });
    await expectNoA11yViolations(container);
  });
});

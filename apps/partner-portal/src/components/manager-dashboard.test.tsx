import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { ManagerDashboard, type ManagerDashboardPorts } from './manager-dashboard';

function samplePorts(overrides: Partial<ManagerDashboardPorts> = {}): ManagerDashboardPorts {
  return {
    loadOrders: vi.fn<ManagerDashboardPorts['loadOrders']>(() =>
      Promise.resolve({
        ok: true,
        rows: [
          {
            orderId: '019ab100-0000-7000-8000-000000000001',
            offerId: '019ab100-0000-7000-8000-000000000011',
            offerTitle: 'Réfrigérateur 150 L',
            status: 'FUNDED',
            targetXaf: '185000',
            progressBasisPoints: 10000,
            createdAt: '2026-11-10T09:00:00.000Z',
            handedOverAt: null,
          },
          {
            orderId: '019ab100-0000-7000-8000-000000000002',
            offerId: '019ab100-0000-7000-8000-000000000012',
            offerTitle: 'Cuisinière 4 feux',
            status: 'ACTIVE',
            targetXaf: '98000',
            progressBasisPoints: 6000,
            createdAt: '2026-11-12T09:00:00.000Z',
            handedOverAt: null,
          },
          {
            orderId: '019ab100-0000-7000-8000-000000000003',
            offerId: '019ab100-0000-7000-8000-000000000013',
            offerTitle: 'Téléviseur 43 pouces',
            status: 'HANDED_OVER',
            targetXaf: '210000',
            progressBasisPoints: 10000,
            createdAt: '2026-11-01T09:00:00.000Z',
            handedOverAt: '2026-11-18T10:05:00.000Z',
          },
        ],
      }),
    ),
    loadPayouts: vi.fn<ManagerDashboardPorts['loadPayouts']>(() =>
      Promise.resolve({
        ok: true,
        rows: [
          {
            payoutId: '019ab100-0000-7000-8000-000000000021',
            agreementId: '019ab100-0000-7000-8000-000000000003',
            grossXaf: '210000',
            commissionXaf: '10500',
            netXaf: '199500',
            status: 'PREPARED',
            executedAt: null,
            bankReference: null,
          },
        ],
      }),
    ),
    loadOffers: vi.fn<ManagerDashboardPorts['loadOffers']>(() =>
      Promise.resolve({
        ok: true,
        rows: [
          {
            offerId: '019ab100-0000-7000-8000-000000000011',
            version: 1,
            title: 'Réfrigérateur 150 L',
            state: 'PUBLISHED',
            priceXaf: '185000',
            availabilityKind: 'IN_STOCK',
            stockUnits: 5,
            availableUnits: 1,
            publiclyVisible: true,
            updatedAt: '2026-11-18T08:00:00.000Z',
          },
        ],
      }),
    ),
    ...overrides,
  };
}

describe('09_… § 4.2 · Tableau de bord du gérant (portail partenaire à plat)', () => {
  it('agrège les commandes, règlements et stocks réels sans verre ni valeur avant réponse serveur', async () => {
    let resolveOrders!: (value: Awaited<ReturnType<ManagerDashboardPorts['loadOrders']>>) => void;
    const delayed = samplePorts({
      loadOrders: () => new Promise((res) => { resolveOrders = res; }),
    });
    const { container } = render(<ManagerDashboard ports={delayed} locale="fr" />);

    // Avant la réponse du serveur : aucun compteur ni montant affirmé.
    expect(screen.queryByText('Réfrigérateur 150 L')).toBeNull();
    expect(container.querySelector('.mp-glass')).toBeNull();
    expect(container.querySelector('.mp-liquid')).toBeNull();

    resolveOrders(await samplePorts().loadOrders());
    await waitFor(() => { expect(screen.getByText('Réfrigérateur 150 L')).toBeVisible(); });

    expect(screen.getByText(/anonymes jusqu’à 100 %/i)).toBeVisible();
    expect(screen.getByRole('link', { name: /Exporter/i })).toHaveAttribute('href', '/v1/partner/orders/export');
    expect(screen.getByText(/199\s*500\s*FCFA/)).toBeVisible();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Remises confirmées/i }));
    expect(screen.getByText('Téléviseur 43 pouces')).toBeVisible();

    await expectNoA11yViolations(container);
  });

  it('refuse : affiche exactement le problème RFC 9457 si le serveur refuse la lecture (ex. vendeur 403)', async () => {
    const forbidden = samplePorts({
      loadPayouts: () =>
        Promise.resolve({
          ok: false,
          problem: { title: 'Accès interdit', detail: 'PARTNER_MANAGER_REQUIRED', status: 403 },
        }),
    });
    render(<ManagerDashboard ports={forbidden} locale="en" />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('PARTNER_MANAGER_REQUIRED');
    });
  });
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { CounterHandover } from './counter-handover';
import { OffersBoard } from './offers-board';
import { OrdersBoard, PayoutsBoard } from './partner-boards';
import { PartnerEnrollment } from './partner-enrollment';
import { PartnerLogin } from './partner-login';
import { PortalNav } from './portal-nav';
import { SellersPanel } from './sellers-panel';

/** NF-UX-002 : chaque écran du portail partenaire est disponible en anglais. */
describe('NF-UX-002 portail partenaire en anglais', () => {
  it('connexion et enrôlement : libellés et erreurs en anglais', async () => {
    const user = userEvent.setup();
    const ports = { requestChallenge: vi.fn(), getAssertion: vi.fn(), openSession: vi.fn() };
    const { unmount } = render(<PartnerLogin locale="en" ports={ports} onSignedIn={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'MoloPay partner portal' })).toBeVisible();
    await user.type(screen.getByLabelText('Username'), 'A B');
    await user.click(screen.getByRole('button', { name: 'Sign in with my security key' }));
    expect(screen.getByText(/Invalid username/)).toBeVisible();
    unmount();
    render(<PartnerEnrollment locale="en" ports={{ createCredential: vi.fn(), register: vi.fn() }} />);
    expect(screen.getByLabelText('Enrolment code')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Register my security key' })).toBeVisible();
  });

  it('comptoir : confirmation en anglais avec heure', async () => {
    const user = userEvent.setup();
    render(
      <CounterHandover
        locale="en"
        ports={{
          locate: () => Promise.resolve({ latitude: 4.05, longitude: 9.76 }),
          confirm: () => Promise.resolve({ ok: true, agreementId: 'A-1', validatedAt: '2026-11-17T10:00:00.000Z' }),
        }}
      />,
    );
    await user.type(screen.getByLabelText('Customer handover code'), 'ABCDE12345');
    await user.click(screen.getByRole('button', { name: 'Confirm the handover' }));
    await waitFor(() => { expect(screen.getByRole('status')).toHaveTextContent(/^Handover confirmed for order A-1 at .+\. You may hand over the item\.$/); });
  });

  it('commandes, règlements, offres : en-têtes et états en anglais', async () => {
    const order = { orderId: 'o1', offerId: 'f1', offerTitle: 'Fridge', status: 'FUNDED' as const, targetXaf: '150000', progressBasisPoints: 10000, createdAt: '2026-11-01T09:00:00.000Z', handedOverAt: null };
    const payout = { payoutId: 'p1', agreementId: 'o1', grossXaf: '150000', commissionXaf: '3750', netXaf: '146250', status: 'EXECUTED' as const, executedAt: null, bankReference: null };
    const ports = { loadOrders: () => Promise.resolve({ ok: true as const, rows: [order] }), loadPayouts: () => Promise.resolve({ ok: true as const, rows: [payout] }) };
    const first = render(<OrdersBoard locale="en" role="MANAGER" ports={ports} />);
    const orders = await screen.findByRole('table', { name: 'Orders' });
    expect(within(orders).getAllByRole('row')[1]).toHaveTextContent('Fully funded');
    expect(screen.getByRole('link', { name: 'Export orders (CSV)' })).toBeVisible();
    first.unmount();
    const second = render(<PayoutsBoard locale="en" ports={ports} />);
    expect(within(await screen.findByRole('table', { name: 'Settlements' })).getAllByRole('row')[1]).toHaveTextContent('Paid');
    second.unmount();
    render(<OffersBoard locale="en" ports={{ load: () => Promise.resolve({ ok: true, rows: [] }) }} />);
    expect(await screen.findByText('No offers.')).toBeVisible();
  });

  it('personnel et navigation : en anglais, lien vers le français', async () => {
    const users = [{ userId: 'u2', login: 'paul.vendeur', role: 'SELLER' as const, active: true }];
    const first = render(<SellersPanel locale="en" ports={{ load: () => Promise.resolve({ ok: true, users }), create: vi.fn(), issueEnrollment: vi.fn(), disable: vi.fn() }} />);
    expect(await screen.findByRole('button', { name: 'Issue an enrolment code for paul.vendeur' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create the seller' })).toBeVisible();
    first.unmount();
    const { container } = render(<PortalNav locale="en" role="MANAGER" signOut={vi.fn()} onSignedOut={vi.fn()} />);
    expect(screen.getByRole('navigation', { name: 'Partner portal' })).toHaveTextContent('Settlements');
    expect(screen.getByRole('link', { name: 'Français' })).toHaveAttribute('href', '/langue/fr');
    await expectNoA11yViolations(container);
  });

  it('navigation en français : lien vers l’anglais', () => {
    render(<PortalNav role="SELLER" signOut={vi.fn()} onSignedOut={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'English' })).toHaveAttribute('href', '/langue/en');
  });
});

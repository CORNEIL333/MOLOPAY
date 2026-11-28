import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { SellersPanel, type SellersPorts } from './sellers-panel';

const MANAGER = { userId: '019ab100-0000-7000-8000-0000000000d1', login: 'awa.gerant', role: 'MANAGER' as const, active: true };
const SELLER = { userId: '019ab100-0000-7000-8000-0000000000d2', login: 'paul.vendeur', role: 'SELLER' as const, active: true };

function ports(overrides: Partial<SellersPorts> = {}): SellersPorts {
  return {
    load: vi.fn<SellersPorts['load']>(() => Promise.resolve({ ok: true, users: [MANAGER, SELLER] })),
    create: vi.fn<SellersPorts['create']>(() => Promise.resolve({ ok: true, sellerId: '019ab100-0000-7000-8000-0000000000d3' })),
    issueEnrollment: vi.fn<SellersPorts['issueEnrollment']>(() =>
      Promise.resolve({ ok: true, challengeId: '019ab100-0000-7000-8000-0000000000e1', challenge: 'AAEC', enrollmentToken: 't'.repeat(43) }),
    ),
    disable: vi.fn<SellersPorts['disable']>(() => Promise.resolve({ ok: true })),
    ...overrides,
  };
}

describe('F-PRT-003 / D63 gestion des vendeurs par le gérant', () => {
  it('liste du personnel ; actions seulement sur les vendeurs actifs', async () => {
    render(<SellersPanel ports={ports()} />);
    const table = await screen.findByRole('table', { name: 'Personnel' });
    const [, managerRow, sellerRow] = within(table).getAllByRole('row');
    expect(managerRow).toHaveTextContent('Gérant');
    expect(within(managerRow as HTMLElement).queryByRole('button')).toBeNull();
    expect(within(sellerRow as HTMLElement).getByRole('button', { name: 'Émettre un code d’enrôlement pour paul.vendeur' })).toBeVisible();
  });

  it('création d’un vendeur : identifiant validé, liste rechargée', async () => {
    const user = userEvent.setup();
    const injected = ports();
    render(<SellersPanel ports={injected} />);
    await screen.findByRole('table', { name: 'Personnel' });
    await user.type(screen.getByLabelText('Identifiant du nouveau vendeur'), 'Mauvais Login');
    await user.click(screen.getByRole('button', { name: 'Créer le vendeur' }));
    expect(screen.getByText(/Identifiant invalide/)).toBeVisible();
    expect(injected.create).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Identifiant du nouveau vendeur'));
    await user.type(screen.getByLabelText('Identifiant du nouveau vendeur'), 'lea.vendeuse');
    await user.click(screen.getByRole('button', { name: 'Créer le vendeur' }));
    await waitFor(() => { expect(injected.create).toHaveBeenCalledWith('lea.vendeuse'); });
    await waitFor(() => { expect(injected.load).toHaveBeenCalledTimes(2); });
  });

  it('code d’enrôlement affiché une seule fois, au format défi.challenge.jeton, puis masquable', async () => {
    const user = userEvent.setup();
    render(<SellersPanel ports={ports()} />);
    await user.click(await screen.findByRole('button', { name: 'Émettre un code d’enrôlement pour paul.vendeur' }));
    const code = await screen.findByLabelText('Code d’enrôlement à remettre en main propre');
    expect(code).toHaveTextContent(`019ab100-0000-7000-8000-0000000000e1.AAEC.${'t'.repeat(43)}`);
    await user.click(screen.getByRole('button', { name: 'J’ai remis le code' }));
    expect(screen.queryByLabelText('Code d’enrôlement à remettre en main propre')).toBeNull();
  });

  it('désactivation : motif obligatoire, puis appel et rechargement', async () => {
    const user = userEvent.setup();
    const injected = ports();
    render(<SellersPanel ports={injected} />);
    await user.click(await screen.findByRole('button', { name: 'Désactiver paul.vendeur' }));
    await user.click(screen.getByRole('button', { name: 'Confirmer la désactivation' }));
    expect(screen.getByText(/motif est obligatoire/)).toBeVisible();
    expect(injected.disable).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Motif de la désactivation'), 'fin de contrat');
    await user.click(screen.getByRole('button', { name: 'Confirmer la désactivation' }));
    await waitFor(() => { expect(injected.disable).toHaveBeenCalledWith(SELLER.userId, 'fin de contrat'); });
    await waitFor(() => { expect(injected.load).toHaveBeenCalledTimes(2); });
  });

  it('structure accessible', async () => {
    const { container } = render(<SellersPanel ports={ports()} />);
    await screen.findByRole('table', { name: 'Personnel' });
    await expectNoA11yViolations(container);
  });
});

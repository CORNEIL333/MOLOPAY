import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { PortalNav } from './portal-nav';

describe('D63 navigation du portail selon le rôle', () => {
  it('vendeur : comptoir, commandes, offres ; ni règlements ni vendeurs', () => {
    render(<PortalNav role="SELLER" signOut={vi.fn()} onSignedOut={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'Portail partenaire' });
    expect(nav).toHaveTextContent('Comptoir');
    expect(screen.getByRole('link', { name: 'Commandes' })).toHaveAttribute('href', '/commandes');
    expect(screen.getByRole('link', { name: 'Offres' })).toHaveAttribute('href', '/offres');
    expect(screen.queryByRole('link', { name: 'Règlements' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Vendeurs' })).toBeNull();
  });

  it('gérant : règlements et vendeurs en plus', () => {
    render(<PortalNav role="MANAGER" signOut={vi.fn()} onSignedOut={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Règlements' })).toHaveAttribute('href', '/reglements');
    expect(screen.getByRole('link', { name: 'Vendeurs' })).toHaveAttribute('href', '/vendeurs');
  });

  it('déconnexion : session révoquée côté serveur puis retour à la connexion, même si l’appel échoue', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(() => Promise.reject(new Error('réseau')));
    const onSignedOut = vi.fn();
    render(<PortalNav role="SELLER" signOut={signOut} onSignedOut={onSignedOut} />);
    await user.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    await waitFor(() => { expect(onSignedOut).toHaveBeenCalled(); });
    expect(signOut).toHaveBeenCalled();
  });

  it('structure accessible', async () => {
    const { container } = render(<PortalNav role="MANAGER" signOut={vi.fn()} onSignedOut={vi.fn()} />);
    await expectNoA11yViolations(container);
  });
});

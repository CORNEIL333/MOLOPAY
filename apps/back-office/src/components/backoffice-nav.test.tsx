import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { BackofficeNav } from './backoffice-nav';

describe('C6 navigation du back-office', () => {
  it('liens vers toutes les pages, page courante signalée ; aucun menu sur la connexion et l’enrôlement', () => {
    const { rerender } = render(<BackofficeNav pathname="/file" signOut={vi.fn(() => Promise.resolve())} onSignedOut={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'Back-office' });
    const links = [...nav.querySelectorAll('a')].map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links).toEqual([
      ['File de travail', '/file'],
      ['Tableau de bord', '/tableau-de-bord'],
      ['Conformité', '/conformite'],
      ['Réclamations', '/reclamations'],
      ['Historique d’un objectif', '/objectifs'],
      ['Bloquer un compte client', '/clients/blocage'],
      ['Gel des flux sortants', '/incidents/gel'],
      ['Administration', '/administration'],
    ]);
    expect(screen.getByRole('link', { name: 'File de travail' })).toHaveAttribute('aria-current', 'page');
    rerender(<BackofficeNav pathname="/" signOut={vi.fn(() => Promise.resolve())} onSignedOut={vi.fn()} />);
    expect(screen.queryByRole('navigation')).toBeNull();
    rerender(<BackofficeNav pathname="/enrolement" signOut={vi.fn(() => Promise.resolve())} onSignedOut={vi.fn()} />);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('déconnexion : révocation demandée au serveur, puis retour à la connexion même en cas d’échec réseau', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(() => Promise.reject(new Error('réseau')));
    const onSignedOut = vi.fn();
    render(<BackofficeNav pathname="/conformite" signOut={signOut} onSignedOut={onSignedOut} />);
    await user.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    await waitFor(() => { expect(onSignedOut).toHaveBeenCalled(); });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('structure accessible', async () => {
    render(<BackofficeNav pathname="/objectifs" signOut={vi.fn(() => Promise.resolve())} onSignedOut={vi.fn()} />);
    await expectNoA11yViolations(document.body);
  });
});

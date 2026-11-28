import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { components } from '@achat/contracts/api';
import { AccountSecurityView } from './account-security';
import { expectNoA11yViolations } from '../../test/a11y';

const security: components['schemas']['AccountSecurity'] = {
  asOf: '2026-11-06T10:00:00.000Z',
  devices: [{ deviceId: '019a9500-0000-7000-8000-000000000011', name: 'Téléphone de test', status: 'ACTIVE', registeredAt: '2026-11-01T10:00:00.000Z', current: true }],
  sessions: [{ sessionId: '019a9500-0000-7000-8000-000000000021', deviceName: 'Téléphone de test', createdAt: '2026-11-06T09:55:00.000Z', accessExpiresAt: '2026-11-06T10:10:00.000Z', refreshExpiresAt: '2026-11-07T10:00:00.000Z', current: true }],
};
describe('F-ACC-006 / SEC-AUTH-005 · espace sécurité du compte', () => {
  it('affiche les appareils et sessions sans identifiants techniques visibles', () => {
    const { container } = render(<AccountSecurityView security={security} locale="fr" />);
    expect(screen.getAllByText('Téléphone de test')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Mes appareils' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Mes sessions' })).toBeVisible();
    expect(container.textContent).not.toContain(security.devices[0]!.deviceId);
    expect(container.textContent).not.toContain(security.sessions[0]!.sessionId);
  });
  it('demande une confirmation de blocage et permet d’annuler sans action', async () => {
    const user = userEvent.setup();
    render(<AccountSecurityView security={security} locale="fr" />);
    const trigger = screen.getByRole('button', { name: 'Bloquer mon compte' });
    await user.click(trigger);
    expect(screen.getByRole('heading', { name: 'Confirmer le blocage' })).toHaveFocus();
    expect(screen.getByText(/ne débloque pas automatiquement/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('button', { name: 'Confirmer' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
  it('ne propose aucune mutation hors ligne', () => {
    render(<AccountSecurityView security={security} locale="fr" />);
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(screen.getByRole('button', { name: 'Bloquer mon compte' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Me déconnecter' })).toBeDisabled();
    expect(screen.getByText('Une connexion réseau est nécessaire.')).toBeVisible();
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(screen.getByRole('button', { name: 'Me déconnecter' })).toBeEnabled();
  });
  it('fournit les libellés anglais et une structure accessible', async () => {
    const { container } = render(<AccountSecurityView security={security} locale="en" />);
    expect(screen.getByRole('heading', { name: 'Account security' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expectNoA11yViolations(container);
  });
});

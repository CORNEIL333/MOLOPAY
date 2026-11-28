import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { StaffLogin, type StaffLoginPorts } from './staff-login';

const CHALLENGE = Uint8Array.from({ length: 32 }, (_, index) => index);

function ports(overrides: Partial<StaffLoginPorts> = {}): StaffLoginPorts {
  return {
    requestChallenge: vi.fn<StaffLoginPorts['requestChallenge']>(() =>
      Promise.resolve({ ok: true, challengeId: '019aa800-0000-7000-8000-000000000001', challenge: Buffer.from(CHALLENGE).toString('base64url'), rpId: 'backoffice.molopay.test' }),
    ),
    getAssertion: vi.fn<StaffLoginPorts['getAssertion']>(() =>
      Promise.resolve({ credentialId: new Uint8Array([1, 2]), clientDataJSON: new Uint8Array([3]), authenticatorData: new Uint8Array([4]), signature: new Uint8Array([5, 6]) }),
    ),
    openSession: vi.fn<StaffLoginPorts['openSession']>(() => Promise.resolve({ ok: true })),
    ...overrides,
  };
}

describe('SEC-AUTH-004 / D62 connexion du personnel par clé de sécurité', () => {
  it('demande le défi, fait signer par la clé (vérification de l’utilisateur exigée), ouvre la session', async () => {
    const user = userEvent.setup();
    const injected = ports();
    const onSignedIn = vi.fn();
    render(<StaffLogin ports={injected} onSignedIn={onSignedIn} />);
    await user.type(screen.getByLabelText('Identifiant'), 'fin.un');
    await user.click(screen.getByRole('button', { name: 'Se connecter avec ma clé de sécurité' }));
    await waitFor(() => { expect(onSignedIn).toHaveBeenCalled(); });
    expect(injected.requestChallenge).toHaveBeenCalledWith('fin.un');
    expect(injected.getAssertion).toHaveBeenCalledWith({ challenge: CHALLENGE, rpId: 'backoffice.molopay.test' });
    expect(injected.openSession).toHaveBeenCalledWith({
      challengeId: '019aa800-0000-7000-8000-000000000001',
      credentialId: 'AQI',
      clientDataJSON: 'Aw',
      authenticatorData: 'BA',
      signature: 'BQY',
    });
  });

  it('identifiant invalide : aucun appel', async () => {
    const user = userEvent.setup();
    const injected = ports();
    render(<StaffLogin ports={injected} onSignedIn={vi.fn()} />);
    await user.type(screen.getByLabelText('Identifiant'), 'A B');
    await user.click(screen.getByRole('button', { name: 'Se connecter avec ma clé de sécurité' }));
    expect(screen.getByText(/Identifiant invalide/)).toBeVisible();
    expect(injected.requestChallenge).not.toHaveBeenCalled();
  });

  it('clé refusée ou geste annulé : message générique, pas de session', async () => {
    const user = userEvent.setup();
    const injected = ports({ getAssertion: vi.fn<StaffLoginPorts['getAssertion']>(() => Promise.reject(new Error('NotAllowedError'))) });
    const onSignedIn = vi.fn();
    render(<StaffLogin ports={injected} onSignedIn={onSignedIn} />);
    await user.type(screen.getByLabelText('Identifiant'), 'fin.un');
    await user.click(screen.getByRole('button', { name: 'Se connecter avec ma clé de sécurité' }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Connexion impossible'); });
    expect(injected.openSession).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('structure accessible', async () => {
    const { container } = render(<StaffLogin ports={ports()} onSignedIn={vi.fn()} />);
    await expectNoA11yViolations(container);
  });
});

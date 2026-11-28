import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { PartnerLogin, type PartnerLoginPorts } from './partner-login';

const CHALLENGE = Uint8Array.from({ length: 32 }, (_, index) => index);

function ports(overrides: Partial<PartnerLoginPorts> = {}): PartnerLoginPorts {
  return {
    requestChallenge: vi.fn<PartnerLoginPorts['requestChallenge']>(() =>
      Promise.resolve({ ok: true, challengeId: '019ab200-0000-7000-8000-000000000001', challenge: Buffer.from(CHALLENGE).toString('base64url'), rpId: 'partenaires.molopay.test' }),
    ),
    getAssertion: vi.fn<PartnerLoginPorts['getAssertion']>(() =>
      Promise.resolve({ credentialId: new Uint8Array([1, 2]), clientDataJSON: new Uint8Array([3]), authenticatorData: new Uint8Array([4]), signature: new Uint8Array([5, 6]) }),
    ),
    openSession: vi.fn<PartnerLoginPorts['openSession']>(() => Promise.resolve({ ok: true, role: 'SELLER' })),
    ...overrides,
  };
}

describe('SEC-AUTH-006 / D63 connexion du partenaire par clé de sécurité', () => {
  it('défi, signature par la clé, session ouverte : le rôle est transmis pour l’orientation', async () => {
    const user = userEvent.setup();
    const injected = ports();
    const onSignedIn = vi.fn();
    render(<PartnerLogin ports={injected} onSignedIn={onSignedIn} />);
    await user.type(screen.getByLabelText('Identifiant'), 'paul.vendeur');
    await user.click(screen.getByRole('button', { name: 'Se connecter avec ma clé de sécurité' }));
    await waitFor(() => { expect(onSignedIn).toHaveBeenCalledWith('SELLER'); });
    expect(injected.requestChallenge).toHaveBeenCalledWith('paul.vendeur');
    expect(injected.getAssertion).toHaveBeenCalledWith({ challenge: CHALLENGE, rpId: 'partenaires.molopay.test' });
    expect(injected.openSession).toHaveBeenCalledWith({
      challengeId: '019ab200-0000-7000-8000-000000000001',
      credentialId: 'AQI',
      clientDataJSON: 'Aw',
      authenticatorData: 'BA',
      signature: 'BQY',
    });
  });

  it('identifiant invalide : aucun appel', async () => {
    const user = userEvent.setup();
    const injected = ports();
    render(<PartnerLogin ports={injected} onSignedIn={vi.fn()} />);
    await user.type(screen.getByLabelText('Identifiant'), 'A B');
    await user.click(screen.getByRole('button', { name: 'Se connecter avec ma clé de sécurité' }));
    expect(screen.getByText(/Identifiant invalide/)).toBeVisible();
    expect(injected.requestChallenge).not.toHaveBeenCalled();
  });

  it('refus du serveur : problème affiché, pas de session', async () => {
    const user = userEvent.setup();
    const onSignedIn = vi.fn();
    const injected = ports({ openSession: vi.fn<PartnerLoginPorts['openSession']>(() => Promise.resolve({ ok: false, problem: { title: 'Authentification requise', status: 401 } })) });
    render(<PartnerLogin ports={injected} onSignedIn={onSignedIn} />);
    await user.type(screen.getByLabelText('Identifiant'), 'paul.vendeur');
    await user.click(screen.getByRole('button', { name: 'Se connecter avec ma clé de sécurité' }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Authentification requise'); });
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('geste annulé : message générique', async () => {
    const user = userEvent.setup();
    const injected = ports({ getAssertion: vi.fn<PartnerLoginPorts['getAssertion']>(() => Promise.reject(new Error('NotAllowedError'))) });
    render(<PartnerLogin ports={injected} onSignedIn={vi.fn()} />);
    await user.type(screen.getByLabelText('Identifiant'), 'paul.vendeur');
    await user.click(screen.getByRole('button', { name: 'Se connecter avec ma clé de sécurité' }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Connexion impossible'); });
    expect(injected.openSession).not.toHaveBeenCalled();
  });

  it('structure accessible', async () => {
    const { container } = render(<PartnerLogin ports={ports()} onSignedIn={vi.fn()} />);
    await expectNoA11yViolations(container);
  });
});

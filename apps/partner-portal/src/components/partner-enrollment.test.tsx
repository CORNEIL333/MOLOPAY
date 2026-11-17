import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { PartnerEnrollment, type PartnerEnrollmentPorts } from './partner-enrollment';

const CHALLENGE_ID = '019ab200-0000-7000-8000-000000000002';
const CHALLENGE = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index)).toString('base64url');
const SECRET = 'b'.repeat(43);
const CODE = `${CHALLENGE_ID}.${CHALLENGE}.${SECRET}`;

function ports(overrides: Partial<PartnerEnrollmentPorts> = {}): PartnerEnrollmentPorts {
  return {
    createCredential: vi.fn<PartnerEnrollmentPorts['createCredential']>(() =>
      Promise.resolve({ credentialId: new Uint8Array([1]), clientDataJSON: new Uint8Array([2]), authenticatorData: new Uint8Array([3]), publicKeySpki: new Uint8Array([4]) }),
    ),
    register: vi.fn<PartnerEnrollmentPorts['register']>(() => Promise.resolve({ ok: true })),
    ...overrides,
  };
}

describe('SEC-AUTH-006 / D63 enrôlement de la clé du partenaire', () => {
  it('code valide : clé créée sur le défi puis enregistrée avec le jeton ; le code est effacé', async () => {
    const user = userEvent.setup();
    const injected = ports();
    render(<PartnerEnrollment ports={injected} />);
    await user.type(screen.getByLabelText('Identifiant'), 'paul.vendeur');
    await user.type(screen.getByLabelText('Code d’enrôlement'), CODE);
    await user.click(screen.getByRole('button', { name: 'Enregistrer ma clé de sécurité' }));
    await waitFor(() => { expect(screen.getByRole('status')).toHaveTextContent('Clé enregistrée'); });
    expect(injected.createCredential).toHaveBeenCalledWith({ challenge: Uint8Array.from({ length: 32 }, (_, index) => index), login: 'paul.vendeur' });
    expect(injected.register).toHaveBeenCalledWith({ challengeId: CHALLENGE_ID, enrollmentToken: SECRET, credentialId: 'AQ', clientDataJSON: 'Ag', authenticatorData: 'Aw', publicKeySpki: 'BA' });
    expect(screen.getByLabelText('Code d’enrôlement')).toHaveValue('');
  });

  it('code mal recopié : aucun appel', async () => {
    const user = userEvent.setup();
    const injected = ports();
    render(<PartnerEnrollment ports={injected} />);
    await user.type(screen.getByLabelText('Identifiant'), 'paul.vendeur');
    await user.type(screen.getByLabelText('Code d’enrôlement'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Enregistrer ma clé de sécurité' }));
    expect(screen.getByText(/Code d’enrôlement invalide/)).toBeVisible();
    expect(injected.createCredential).not.toHaveBeenCalled();
  });

  it('création refusée par l’authentificateur : message, rien n’est envoyé', async () => {
    const user = userEvent.setup();
    const injected = ports({ createCredential: vi.fn<PartnerEnrollmentPorts['createCredential']>(() => Promise.reject(new Error('NotAllowedError'))) });
    render(<PartnerEnrollment ports={injected} />);
    await user.type(screen.getByLabelText('Identifiant'), 'paul.vendeur');
    await user.type(screen.getByLabelText('Code d’enrôlement'), CODE);
    await user.click(screen.getByRole('button', { name: 'Enregistrer ma clé de sécurité' }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Enrôlement impossible'); });
    expect(injected.register).not.toHaveBeenCalled();
  });

  it('structure accessible', async () => {
    const { container } = render(<PartnerEnrollment ports={ports()} />);
    await expectNoA11yViolations(container);
  });
});

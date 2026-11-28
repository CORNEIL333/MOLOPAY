import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { StaffEnrollment, type StaffEnrollmentPorts } from './staff-enrollment';

const CHALLENGE_ID = '019aac00-0000-7000-8000-000000000001';
const CHALLENGE = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index)).toString('base64url');
const SECRET = 'b'.repeat(43);
const CODE = `${CHALLENGE_ID}.${CHALLENGE}.${SECRET}`;

function ports(overrides: Partial<StaffEnrollmentPorts> = {}): StaffEnrollmentPorts {
  return {
    createCredential: vi.fn<StaffEnrollmentPorts['createCredential']>(() =>
      Promise.resolve({ credentialId: new Uint8Array([1]), clientDataJSON: new Uint8Array([2]), authenticatorData: new Uint8Array([3]), publicKeySpki: new Uint8Array([4]) }),
    ),
    register: vi.fn<StaffEnrollmentPorts['register']>(() => Promise.resolve({ ok: true })),
    ...overrides,
  };
}

describe('SEC-AUTH-004 / D62 enrôlement de la clé de sécurité par l’agent', () => {
  it('code valide : la clé est créée sur le défi, puis enregistrée avec le jeton', async () => {
    const user = userEvent.setup();
    const injected = ports();
    render(<StaffEnrollment ports={injected} />);
    await user.type(screen.getByLabelText('Identifiant'), 'awa.support');
    await user.type(screen.getByLabelText('Code d’enrôlement'), CODE);
    await user.click(screen.getByRole('button', { name: 'Enregistrer ma clé de sécurité' }));
    await waitFor(() => { expect(screen.getByRole('status')).toHaveTextContent('Clé enregistrée'); });
    expect(vi.mocked(injected.createCredential).mock.calls[0]![0]).toMatchObject({ login: 'awa.support' });
    expect(Buffer.from(vi.mocked(injected.createCredential).mock.calls[0]![0].challenge).toString('base64url')).toBe(CHALLENGE);
    expect(injected.register).toHaveBeenCalledWith({
      challengeId: CHALLENGE_ID,
      enrollmentToken: SECRET,
      credentialId: 'AQ',
      clientDataJSON: 'Ag',
      authenticatorData: 'Aw',
      publicKeySpki: 'BA',
    });
  });

  it('code mal formé : aucun appel à la clé', async () => {
    const user = userEvent.setup();
    const injected = ports();
    render(<StaffEnrollment ports={injected} />);
    await user.type(screen.getByLabelText('Identifiant'), 'awa.support');
    await user.type(screen.getByLabelText('Code d’enrôlement'), 'pas-un-code');
    await user.click(screen.getByRole('button', { name: 'Enregistrer ma clé de sécurité' }));
    expect(screen.getByText(/Code d’enrôlement invalide/)).toBeVisible();
    expect(injected.createCredential).not.toHaveBeenCalled();
  });

  it('refus du serveur affiché ; structure accessible', async () => {
    const user = userEvent.setup();
    const injected = ports({ register: vi.fn<StaffEnrollmentPorts['register']>(() => Promise.resolve({ ok: false, problem: { title: 'Authentification requise', detail: 'Authentification refusée' } })) });
    const { container } = render(<StaffEnrollment ports={injected} />);
    await user.type(screen.getByLabelText('Identifiant'), 'awa.support');
    await user.type(screen.getByLabelText('Code d’enrôlement'), CODE);
    await user.click(screen.getByRole('button', { name: 'Enregistrer ma clé de sécurité' }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Authentification refusée'); });
    await expectNoA11yViolations(container);
  });
});

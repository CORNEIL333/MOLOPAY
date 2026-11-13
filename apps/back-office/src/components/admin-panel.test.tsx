import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { AdminPanel, type AdminPort } from './admin-panel';

const REQUEST = '019aab00-0000-7000-8000-000000000001';
const STAFF = '019aab00-0000-7000-8000-0000000000aa';

function port(body: Record<string, unknown> = {}): ReturnType<typeof vi.fn<AdminPort>> {
  return vi.fn<AdminPort>(() => Promise.resolve({ ok: true, body }));
}

describe('SEC-AUTHZ-003 / D62 écrans d’administration', () => {
  it('nouvel agent : prépare une demande ROLE_GRANT avec un identifiant UUID v7 et l’identifiant de connexion', async () => {
    const user = userEvent.setup();
    const post = port({ requestId: REQUEST });
    render(<AdminPanel post={post} />);
    await user.type(screen.getByLabelText('Identifiant du nouvel agent'), 'awa.support');
    await user.click(screen.getByRole('button', { name: 'Préparer la création' }));
    await waitFor(() => { expect(screen.getByText(/Demande préparée/)).toBeVisible(); });
    const call = post.mock.calls[0]![0];
    expect(call.path).toBe('/v1/backoffice/admin/approvals');
    expect(call.body).toMatchObject({ kind: 'ROLE_GRANT', reason: 'Création du compte awa.support', payload: { operation: 'CREATE_STAFF', login: 'awa.support' } });
    expect((call.body['payload'] as { staff_id: string }).staff_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it('décision d’une demande : refus avec motif obligatoire', async () => {
    const user = userEvent.setup();
    const post = port();
    render(<AdminPanel post={post} />);
    await user.type(screen.getByLabelText('Identifiant de la demande'), REQUEST);
    await user.click(screen.getByRole('button', { name: 'Refuser la demande' }));
    expect(screen.getByText(/Un refus exige un motif/)).toBeVisible();
    expect(post).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Motif de la décision'), 'agent inconnu');
    await user.click(screen.getByRole('button', { name: 'Refuser la demande' }));
    expect(post).toHaveBeenCalledWith({ path: `/v1/backoffice/admin/approvals/${REQUEST}/decision`, body: { decision: 'REJECTED', reason: 'agent inconnu' } });
  });

  it('paramètre financier : préparation (valeur numérique), puis publication avec la demande approuvée', async () => {
    const user = userEvent.setup();
    const post = port({ requestId: REQUEST });
    render(<AdminPanel post={post} />);
    await user.selectOptions(screen.getByLabelText('Paramètre'), 'merchant_commission_bps');
    await user.type(screen.getByLabelText('Valeur'), '250');
    await user.click(screen.getByRole('button', { name: 'Préparer le paramètre' }));
    expect(post.mock.calls[0]![0].body).toMatchObject({ kind: 'FINANCIAL_SETTING', payload: { key: 'merchant_commission_bps', value: 250 } });
    await user.type(screen.getByLabelText('Demande approuvée'), REQUEST);
    await user.click(screen.getByRole('button', { name: 'Publier le paramètre' }));
    expect(post).toHaveBeenLastCalledWith({ path: '/v1/backoffice/admin/settings', body: { key: 'merchant_commission_bps', value: 250, approvalRequestId: REQUEST } });
  });

  it('jeton d’enrôlement affiché une seule fois, effacé à l’action suivante ; structure accessible', async () => {
    const user = userEvent.setup();
    const post = port({ challengeId: 'c', challenge: 'x', enrollmentToken: 'jeton-de-test' });
    const { container } = render(<AdminPanel post={post} />);
    await user.type(screen.getByLabelText('Agent à enrôler'), STAFF);
    await user.click(screen.getByRole('button', { name: 'Émettre un jeton d’enrôlement' }));
    expect(await screen.findByText('jeton-de-test')).toBeVisible();
    expect(screen.getByText(/ne sera plus affiché/)).toBeVisible();
    await expectNoA11yViolations(container);
    await user.type(screen.getByLabelText('Identifiant de la demande'), REQUEST);
    await user.click(screen.getByRole('button', { name: 'Approuver la demande' }));
    expect(screen.queryByText('jeton-de-test')).not.toBeInTheDocument();
  });

  it('finaliser la création, attribuer des rôles depuis une demande approuvée, désactiver avec motif', async () => {
    const user = userEvent.setup();
    const post = port({ staffId: STAFF });
    render(<AdminPanel post={post} />);
    await user.type(screen.getByLabelText('Identifiant du nouvel agent'), 'awa.support');
    await user.type(screen.getByLabelText('Agent concerné'), STAFF);
    await user.type(screen.getByLabelText('Demande approuvée (agent)'), REQUEST);
    await user.click(screen.getByRole('button', { name: 'Finaliser la création' }));
    expect(post).toHaveBeenLastCalledWith({ path: '/v1/backoffice/admin/staff', body: { staffId: STAFF, login: 'awa.support', approvalRequestId: REQUEST } });
    await user.click(screen.getByLabelText('SUPPORT_N2'));
    await user.click(screen.getByLabelText('douala'));
    await user.click(screen.getByRole('button', { name: 'Préparer l’attribution des rôles' }));
    expect(post.mock.lastCall![0].body).toMatchObject({ kind: 'ROLE_GRANT', payload: { operation: 'GRANT_ROLES', staff_id: STAFF, roles: ['SUPPORT_N2'], city_ids: ['douala'], max_amount_xaf: null } });
    await user.click(screen.getByRole('button', { name: 'Attribuer les rôles approuvés' }));
    expect(post).toHaveBeenLastCalledWith({ path: `/v1/backoffice/admin/staff/${STAFF}/roles`, body: { roles: ['SUPPORT_N2'], cityIds: ['douala'], maxAmountXaf: null, approvalRequestId: REQUEST } });
    await user.click(screen.getByRole('button', { name: 'Désactiver l’agent' }));
    expect(screen.getByText(/Une désactivation exige un motif/)).toBeVisible();
    await user.type(screen.getByLabelText('Motif de la décision'), 'départ');
    await user.click(screen.getByRole('button', { name: 'Désactiver l’agent' }));
    expect(post).toHaveBeenLastCalledWith({ path: `/v1/backoffice/admin/staff/${STAFF}/disable`, body: { reason: 'départ' } });
  });
});


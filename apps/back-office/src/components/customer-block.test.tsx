import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { CustomerBlock, type CustomerBlockPorts } from './customer-block';

const ID = '019ab820-0000-7000-8000-0000000000c1';

function ports(overrides: Partial<CustomerBlockPorts> = {}): CustomerBlockPorts {
  return { block: vi.fn<CustomerBlockPorts['block']>(() => Promise.resolve({ ok: true, blockedAt: '2026-11-20T10:00:00.000Z' })), ...overrides };
}

async function prepare(injected: CustomerBlockPorts, id = ID, reason = 'Téléphone volé, appel vérifié'): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<CustomerBlock ports={injected} />);
  await user.type(screen.getByLabelText('Identifiant du compte client'), id);
  await user.type(screen.getByLabelText('Motif du blocage'), reason);
  await user.click(screen.getByRole('button', { name: 'Préparer le blocage' }));
  return user;
}

describe('C4 / F-ACC-006 blocage d’un compte client au back-office', () => {
  it('identifiant ou motif invalide : aucun appel', async () => {
    const injected = ports();
    await prepare(injected, 'pas-un-uuid', 'ab');
    expect(screen.getByText(/Identifiant de compte invalide/)).toBeVisible();
    expect(screen.getByText(/motif est obligatoire/)).toBeVisible();
    expect(injected.block).not.toHaveBeenCalled();
  });

  it('confirmation explicite : résumé (compte, motif, conséquences), puis blocage ; annulation sans appel', async () => {
    const injected = ports();
    const user = await prepare(injected);
    const summary = screen.getByRole('region', { name: 'Confirmer le blocage' });
    expect(summary).toHaveTextContent(ID);
    expect(summary).toHaveTextContent('Téléphone volé, appel vérifié');
    expect(summary).toHaveTextContent(/appareils et sessions du client sont fermés/);
    expect(injected.block).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('region', { name: 'Confirmer le blocage' })).toBeNull();
    expect(injected.block).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Préparer le blocage' }));
    await user.click(screen.getByRole('button', { name: 'Bloquer le compte' }));
    await waitFor(() => { expect(injected.block).toHaveBeenCalledWith(ID, 'Téléphone volé, appel vérifié'); });
    expect(await screen.findByRole('status')).toHaveTextContent('Compte bloqué');
    expect(injected.block).toHaveBeenCalledTimes(1);
  });

  it('refus du serveur (compte déjà bloqué) : problème affiché', async () => {
    const user = await prepare(ports({ block: () => Promise.resolve({ ok: false, problem: { title: 'Action interdite', detail: 'compte déjà bloqué', status: 403 } }) }));
    await user.click(screen.getByRole('button', { name: 'Bloquer le compte' }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('compte déjà bloqué'); });
  });

  it('structure accessible', async () => {
    await prepare(ports());
    await expectNoA11yViolations(document.body);
  });
});

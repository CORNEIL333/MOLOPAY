import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { OutgoingFreeze, type OutgoingFreezePorts, type FreezeState } from './outgoing-freeze';

const OPEN: FreezeState = { frozen: false, since: null, reason: null, divergence: null, pending: [] };
const PENDING: FreezeState = {
  frozen: false, since: null, reason: null, divergence: null,
  pending: [{ requestId: '019ab850-0000-7000-8000-0000000000f1', action: 'FREEZE', reason: 'Relevé incohérent', requestedBy: 'fin.un', requestedAt: '2026-11-21T08:00:00.000Z' }],
};
const FROZEN: FreezeState = { frozen: true, since: '2026-11-21T08:05:00.000Z', reason: 'Relevé incohérent', divergence: null, pending: [] };
const DIVERGED: FreezeState = {
  frozen: true, since: '2026-11-21T02:00:00.000Z', reason: null,
  divergence: { code: 'ENTRY_HASH_MISMATCH', detectedAt: '2026-11-21T02:00:00.000Z' }, pending: [],
};

function ports(states: readonly FreezeState[], overrides: Partial<OutgoingFreezePorts> = {}): OutgoingFreezePorts {
  let index = 0;
  return {
    load: vi.fn<OutgoingFreezePorts['load']>(() => Promise.resolve({ ok: true, state: states[Math.min(index++, states.length - 1)] ?? OPEN })),
    request: vi.fn<OutgoingFreezePorts['request']>(() => Promise.resolve({ ok: true })),
    confirm: vi.fn<OutgoingFreezePorts['confirm']>(() => Promise.resolve({ ok: true })),
    ...overrides,
  };
}

describe('C7 / SEC-INC-003 gel des flux sortants au back-office', () => {
  it('flux ouverts : demande de gel motivée (motif obligatoire), puis état relu', async () => {
    const user = userEvent.setup();
    const injected = ports([OPEN, PENDING]);
    render(<OutgoingFreeze ports={injected} />);
    expect(await screen.findByRole('status')).toHaveTextContent('Flux sortants ouverts');
    await user.click(screen.getByRole('button', { name: 'Demander le gel' }));
    expect(screen.getByText(/motif est obligatoire/)).toBeVisible();
    expect(injected.request).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Motif'), 'Relevé incohérent');
    await user.click(screen.getByRole('button', { name: 'Demander le gel' }));
    await waitFor(() => { expect(injected.request).toHaveBeenCalledWith('FREEZE', 'Relevé incohérent'); });
    expect(await screen.findByText(/fin\.un/)).toBeVisible();
  });

  it('demande en attente : confirmation par une autre personne (le serveur refuse l’auteur)', async () => {
    const user = userEvent.setup();
    const injected = ports([PENDING, FROZEN]);
    render(<OutgoingFreeze ports={injected} />);
    await user.click(await screen.findByRole('button', { name: 'Confirmer : gel demandé par fin.un' }));
    await waitFor(() => { expect(injected.confirm).toHaveBeenCalledWith('019ab850-0000-7000-8000-0000000000f1'); });
    expect(await screen.findByRole('status')).toHaveTextContent('Flux sortants gelés');
    expect(screen.getByRole('button', { name: 'Demander la levée du gel' })).toBeVisible();
  });

  it('refus du serveur affiché tel quel', async () => {
    const user = userEvent.setup();
    render(<OutgoingFreeze ports={ports([PENDING], { confirm: () => Promise.resolve({ ok: false, problem: { title: 'Action interdite', detail: 'l’auteur de la demande ne peut pas la confirmer', status: 403 } }) })} />);
    await user.click(await screen.findByRole('button', { name: 'Confirmer : gel demandé par fin.un' }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('l’auteur de la demande'); });
  });

  it('INT-VER-002 gel automatique sur divergence du vérificateur : cause et code affichés ; seule une levée à deux personnes est proposée', async () => {
    render(<OutgoingFreeze ports={ports([DIVERGED])} />);
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Flux sortants gelés');
    expect(status).toHaveTextContent('divergence d’intégrité détectée par le vérificateur indépendant (ENTRY_HASH_MISMATCH)');
    expect(screen.getByRole('button', { name: 'Demander la levée du gel' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Demander le gel' })).toBeNull();
  });

  it('structure accessible', async () => {
    render(<OutgoingFreeze ports={ports([FROZEN])} />);
    await screen.findByRole('status');
    await expectNoA11yViolations(document.body);
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { CounterHandover, type CounterHandoverPorts } from './counter-handover';

const AGREEMENT = '019ab100-0000-7000-8000-0000000000a1';

function ports(overrides: Partial<CounterHandoverPorts> = {}): CounterHandoverPorts {
  return {
    locate: vi.fn<CounterHandoverPorts['locate']>(() => Promise.resolve({ latitude: 4.0510564, longitude: 9.7678689 })),
    confirm: vi.fn<CounterHandoverPorts['confirm']>(() => Promise.resolve({ ok: true, agreementId: AGREEMENT, validatedAt: '2026-11-17T10:00:00.000Z' })),
    ...overrides,
  };
}

describe('F-SET-001 / D63 remise au comptoir', () => {
  it('code saisi, position lue (6 décimales), remise confirmée ; le code est effacé', async () => {
    const user = userEvent.setup();
    const injected = ports();
    render(<CounterHandover ports={injected} />);
    await user.type(screen.getByLabelText('Code de remise du client'), 'abcde-12345');
    await user.click(screen.getByRole('button', { name: 'Confirmer la remise' }));
    await waitFor(() => { expect(screen.getByRole('status')).toHaveTextContent('Remise confirmée'); });
    expect(screen.getByRole('status')).toHaveTextContent(AGREEMENT);
    expect(screen.getByRole('status').querySelector('time')).toHaveAttribute('dateTime', '2026-11-17T10:00:00.000Z');
    expect(injected.confirm).toHaveBeenCalledWith({ code: 'ABCDE-12345', latitude: '4.051056', longitude: '9.767869' });
    expect(screen.getByLabelText('Code de remise du client')).toHaveValue('');
  });

  it('code de forme invalide : aucun appel, ni position ni serveur', async () => {
    const user = userEvent.setup();
    const injected = ports();
    render(<CounterHandover ports={injected} />);
    await user.type(screen.getByLabelText('Code de remise du client'), '12345');
    await user.click(screen.getByRole('button', { name: 'Confirmer la remise' }));
    expect(screen.getByText(/10 caractères/)).toBeVisible();
    expect(injected.locate).not.toHaveBeenCalled();
    expect(injected.confirm).not.toHaveBeenCalled();
  });

  it('position refusée : remise impossible, explication, aucun envoi', async () => {
    const user = userEvent.setup();
    const injected = ports({ locate: vi.fn<CounterHandoverPorts['locate']>(() => Promise.reject(new Error('PERMISSION_DENIED'))) });
    render(<CounterHandover ports={injected} />);
    await user.type(screen.getByLabelText('Code de remise du client'), 'ABCDE12345');
    await user.click(screen.getByRole('button', { name: 'Confirmer la remise' }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Position indisponible'); });
    expect(injected.confirm).not.toHaveBeenCalled();
  });

  it('code refusé par le serveur : problème affiché, saisie conservée pour correction', async () => {
    const user = userEvent.setup();
    const injected = ports({ confirm: vi.fn<CounterHandoverPorts['confirm']>(() => Promise.resolve({ ok: false, problem: { title: 'Règle métier non respectée', detail: 'code de remise invalide', status: 422 } })) });
    render(<CounterHandover ports={injected} />);
    await user.type(screen.getByLabelText('Code de remise du client'), 'ABCDE12345');
    await user.click(screen.getByRole('button', { name: 'Confirmer la remise' }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('code de remise invalide'); });
    expect(screen.getByLabelText('Code de remise du client')).toHaveValue('ABCDE12345');
  });

  it('refuse en mode contrôles complets : exige les deux cases non pré-cochées et le numéro de série (≥ 4 car.)', async () => {
    const user = userEvent.setup();
    const injected = ports();
    const { container } = render(<CounterHandover ports={injected} requireChecklist />);

    const checkId = screen.getByRole('checkbox', { name: /pièce d’identité/i });
    const checkOffer = screen.getByRole('checkbox', { name: /conforme à l’offre/i });
    const serial = screen.getByLabelText(/Numéro de série/i);

    expect(checkId).not.toBeChecked();
    expect(checkOffer).not.toBeChecked();

    await user.type(screen.getByLabelText('Code de remise du client'), 'ABCDE12345');
    await user.click(screen.getByRole('button', { name: 'Confirmer la remise' }));
    expect(injected.locate).not.toHaveBeenCalled();
    expect(injected.confirm).not.toHaveBeenCalled();

    await user.click(checkId);
    await user.click(checkOffer);
    await user.type(serial, 'SN1');
    await user.click(screen.getByRole('button', { name: 'Confirmer la remise' }));
    expect(injected.confirm).not.toHaveBeenCalled();

    await user.clear(serial);
    await user.type(serial, 'SN-4471');
    await user.click(screen.getByRole('button', { name: 'Confirmer la remise' }));
    await waitFor(() => { expect(injected.confirm).toHaveBeenCalledTimes(1); });
    expect(checkId).not.toBeChecked();
    expect(checkOffer).not.toBeChecked();
    expect(serial).toHaveValue('');
    await expectNoA11yViolations(container);
  });

  it('structure accessible', async () => {
    const { container } = render(<CounterHandover ports={ports()} />);
    await expectNoA11yViolations(container);
  });
});

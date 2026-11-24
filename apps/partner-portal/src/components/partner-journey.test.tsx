import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { CounterHandover, type CounterHandoverPorts } from './counter-handover';
import { OrdersBoard, PayoutsBoard, type BoardPorts } from './partner-boards';

describe('G5 — Parcours portail partenaire (hors connexion, refus exacts, actualisation)', () => {
  it('F-SET-001 / NF-OFFLINE : bloque la remise au comptoir hors connexion avec bandeau lisible FR/EN', async () => {
    const confirm = vi.fn<CounterHandoverPorts['confirm']>();
    const locate = vi.fn<CounterHandoverPorts['locate']>();
    const { container, rerender } = render(
      <CounterHandover ports={{ locate, confirm }} locale="fr" />,
    );

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    fireEvent(window, new Event('offline'));

    expect(screen.getByRole('status')).toHaveTextContent(/hors connexion/i);
    expect(screen.getByRole('button', { name: /Confirmer la remise/i })).toBeDisabled();
    expect(confirm).not.toHaveBeenCalled();
    expect((await axe.run(container)).violations).toHaveLength(0);

    rerender(<CounterHandover ports={{ locate, confirm }} locale="en" />);
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect((await axe.run(container)).violations).toHaveLength(0);

    vi.restoreAllMocks();
  });

  it('F-SET-001 : affiche le code métier exact HANDOVER_CODE_EXPIRED sans fausse confirmation', async () => {
    const user = userEvent.setup();
    const locate = vi.fn<CounterHandoverPorts['locate']>().mockResolvedValue({
      latitude: 3.848,
      longitude: 11.502,
    });
    const confirm = vi.fn<CounterHandoverPorts['confirm']>().mockResolvedValue({
      ok: false,
      problem: {
        title: 'Code expiré',
        code: 'HANDOVER_CODE_EXPIRED',
        detail: 'Le code présenté par le client a expiré.',
      },
    });

    render(<CounterHandover ports={{ locate, confirm }} locale="fr" />);
    await user.type(screen.getByLabelText(/Code de remise/i), 'ABCD2-EFGH3');
    await user.click(screen.getByRole('button', { name: /Confirmer la remise/i }));

    expect(await screen.findByText(/HANDOVER_CODE_EXPIRED/)).toBeInTheDocument();
    expect(screen.queryByText(/Remise confirmée/i)).not.toBeInTheDocument();
  });

  it('F-PRT-004 : OrdersBoard et PayoutsBoard permettent une actualisation manuelle accessible', async () => {
    const user = userEvent.setup();
    const loadOrders = vi.fn<BoardPorts['loadOrders']>().mockResolvedValue({
      ok: true,
      rows: [],
    });
    const loadPayouts = vi.fn<BoardPorts['loadPayouts']>().mockResolvedValue({
      ok: true,
      rows: [],
    });

    const { container } = render(
      <>
        <OrdersBoard ports={{ loadOrders, loadPayouts }} role="MANAGER" locale="fr" />
        <PayoutsBoard ports={{ loadOrders, loadPayouts }} locale="fr" />
      </>,
    );

    await waitFor(() => {
      expect(loadOrders).toHaveBeenCalledTimes(1);
      expect(loadPayouts).toHaveBeenCalledTimes(1);
    });

    const refreshButtons = screen.getAllByRole('button', { name: /Actualiser/i });
    expect(refreshButtons).toHaveLength(2);
    await user.click(refreshButtons[0]!);
    await user.click(refreshButtons[1]!);

    await waitFor(() => {
      expect(loadOrders).toHaveBeenCalledTimes(2);
      expect(loadPayouts).toHaveBeenCalledTimes(2);
    });
    expect((await axe.run(container)).violations).toHaveLength(0);
  });
});

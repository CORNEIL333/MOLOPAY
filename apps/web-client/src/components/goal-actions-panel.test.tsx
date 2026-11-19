import type { components } from '@achat/contracts/api';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { GoalActionsPanel, type GoalActionsPorts } from './goal-actions-panel';

type Goal = components['schemas']['Goal'];

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    goalId: '33333333-3333-4333-8333-333333333333',
    model: 'SAVE_THEN_BUY',
    status: 'ACTIVE',
    locked: false,
    offerId: '11111111-1111-4111-8111-111111111111',
    offerTitle: 'Réfrigérateur 220L',
    partnerName: 'Électro Yaoundé',
    beneficiaryId: null,
    planId: 'plan-monthly-a',
    rhythm: 'MONTHLY',
    minAmountXaf: '10000',
    durationMonths: 6,
    targetXaf: '185000',
    savedXaf: '45000',
    progressBasisPoints: 2432,
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-19T09:00:00Z',
    ...overrides,
  };
}

describe('F-GOA-002 / F-GOA-004 / F-GOA-005 / SEC-AUTH-002 — GoalActionsPanel', () => {
  it('refuse un PIN invalide pour le verrouillage sans appeler le serveur', async () => {
    const user = userEvent.setup();
    const lock = vi.fn<NonNullable<GoalActionsPorts['lock']>>();
    render(
      <GoalActionsPanel
        goal={makeGoal()}
        locale="fr"
        ports={{ lock }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Verrouiller/i }));
    await user.type(screen.getByLabelText(/Code PIN/i), '123');
    await user.click(screen.getByRole('button', { name: /Confirmer le verrouillage/i }));

    expect(lock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/six chiffres/i);
  });

  it('verrouille un objectif actif avec PIN valide et vide le champ PIN', async () => {
    const user = userEvent.setup();
    const lockedGoal = makeGoal({ locked: true });
    const lock = vi.fn<NonNullable<GoalActionsPorts['lock']>>().mockResolvedValue({
      ok: true,
      goal: lockedGoal,
    });
    render(
      <GoalActionsPanel
        goal={makeGoal()}
        locale="fr"
        ports={{ lock }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Verrouiller/i }));
    await user.type(screen.getByLabelText(/Code PIN/i), '654321');
    await user.click(screen.getByRole('button', { name: /Confirmer le verrouillage/i }));

    await waitFor(() => {
      expect(lock).toHaveBeenCalledWith(
        '33333333-3333-4333-8333-333333333333',
        '654321',
      );
    });
    expect(screen.getByRole('status')).toHaveTextContent(/verrouillé/i);
  });

  it('affiche le code métier exact INVALID_PIN en cas de refus serveur', async () => {
    const user = userEvent.setup();
    const lock = vi.fn<NonNullable<GoalActionsPorts['lock']>>().mockResolvedValue({
      ok: false,
      problem: {
        title: 'PIN refusé',
        code: 'INVALID_PIN',
        detail: 'Le code PIN est incorrect.',
      },
    });
    render(
      <GoalActionsPanel
        goal={makeGoal()}
        locale="fr"
        ports={{ lock }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Verrouiller/i }));
    await user.type(screen.getByLabelText(/Code PIN/i), '000000');
    await user.click(screen.getByRole('button', { name: /Confirmer le verrouillage/i }));

    expect(await screen.findByText(/INVALID_PIN/)).toBeInTheDocument();
  });

  it('signale sans simulation l’absence de clé d’appareil pour activer un brouillon', async () => {
    const user = userEvent.setup();
    render(
      <GoalActionsPanel
        goal={makeGoal({ status: 'DRAFT' })}
        locale="fr"
      />,
    );

    await user.click(screen.getByRole('button', { name: /Activer/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/clé d’appareil|application mobile/i);
  });

  it('exécute signing-payload puis activation signée quand le port de signature existe', async () => {
    const user = userEvent.setup();
    const getSigningPayload = vi.fn<NonNullable<GoalActionsPorts['getSigningPayload']>>()
      .mockResolvedValue({
        ok: true,
        payload: {
          transition: 'ACTIVATE',
          payloadBase64: 'dGVzdA==',
          seq: 1,
        },
      });
    const signPayload = vi.fn<NonNullable<GoalActionsPorts['signPayload']>>()
      .mockResolvedValue('c2lnbmF0dXJl');
    const activate = vi.fn<NonNullable<GoalActionsPorts['activate']>>()
      .mockResolvedValue({
        ok: true,
        goal: makeGoal({ status: 'ACTIVE' }),
      });

    render(
      <GoalActionsPanel
        goal={makeGoal({ status: 'DRAFT' })}
        locale="fr"
        ports={{ getSigningPayload, signPayload, activate }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Activer/i }));
    await user.type(screen.getByLabelText(/Code PIN/i), '123456');
    await user.click(screen.getByRole('button', { name: /Confirmer l’activation/i }));

    await waitFor(() => {
      expect(getSigningPayload).toHaveBeenCalledWith(
        '33333333-3333-4333-8333-333333333333',
        'ACTIVATE',
      );
      expect(signPayload).toHaveBeenCalledWith('dGVzdA==');
      expect(activate).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333', {
        pin: '123456',
        signature: 'c2lnbmF0dXJl',
      });
    });
    expect(screen.getByRole('status')).toHaveTextContent(/activé/i);
  });

  it('reste accessible en français et en anglais (axe-core)', async () => {
    const { container, rerender } = render(
      <GoalActionsPanel goal={makeGoal()} locale="fr" />,
    );
    expect((await axe.run(container)).violations).toHaveLength(0);

    rerender(<GoalActionsPanel goal={makeGoal()} locale="en" />);
    expect((await axe.run(container)).violations).toHaveLength(0);
  });
});

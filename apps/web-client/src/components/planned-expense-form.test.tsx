import type { components } from '@achat/contracts/api';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { TERMS_VERSION } from '../lib/terms';
import { PlannedExpenseForm, type PlannedExpenseOutcome } from './planned-expense-form';

type PaymentPlan = components['schemas']['PaymentPlan'];
type GoalRequest = components['schemas']['GoalRequest'];

const PLANS: readonly PaymentPlan[] = [
  {
    planId: 'plan-c-monthly',
    model: 'PLANNED_EXPENSE',
    rhythm: 'MONTHLY',
    minAmountXaf: '15000',
    maxDurationMonths: 12,
  },
];

describe('F-PLN-001 / I-12 — PlannedExpenseForm (Modèle C)', () => {
  it('refuse un montant décimal ou nul et des CGU non acceptées sans appeler le serveur', async () => {
    const user = userEvent.setup();
    const createGoal = vi.fn<(input: GoalRequest) => Promise<PlannedExpenseOutcome>>();
    render(
      <PlannedExpenseForm
        plans={PLANS}
        locale="fr"
        createGoal={createGoal}
      />,
    );

    await user.type(screen.getByLabelText(/Identifiant du bénéficiaire/i), 'ben-loyer-01');
    await user.type(screen.getByLabelText(/Montant cible/i), '12500.50');
    await user.click(screen.getByRole('button', { name: /Créer/i }));

    expect(createGoal).not.toHaveBeenCalled();
    expect(screen.getByText(/entier/i)).toBeInTheDocument();
    expect(screen.getByText(/accepter les conditions/i)).toBeInTheDocument();
  });

  it('crée un brouillon modèle C avec entier XAF strict et version CGU', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const createGoal = vi.fn<(input: GoalRequest) => Promise<PlannedExpenseOutcome>>()
      .mockResolvedValue({
        ok: true,
        goal: {
          goalId: '55555555-5555-4555-8555-555555555555',
          model: 'PLANNED_EXPENSE',
          status: 'DRAFT',
          locked: false,
          offerId: null,
          offerTitle: null,
          partnerName: null,
          beneficiaryId: 'ben-loyer-01',
          planId: 'plan-c-monthly',
          rhythm: 'MONTHLY',
          minAmountXaf: '15000',
          durationMonths: 6,
          targetXaf: '300000',
          savedXaf: '0',
          progressBasisPoints: 0,
          createdAt: '2026-11-20T09:00:00Z',
          updatedAt: '2026-11-20T09:00:00Z',
        },
      });

    render(
      <PlannedExpenseForm
        plans={PLANS}
        locale="fr"
        createGoal={createGoal}
        onComplete={onComplete}
      />,
    );

    await user.type(screen.getByLabelText(/Identifiant du bénéficiaire/i), 'ben-loyer-01');
    await user.type(screen.getByLabelText(/Montant cible/i), '300000');
    await user.clear(screen.getByLabelText(/Durée/i));
    await user.type(screen.getByLabelText(/Durée/i), '6');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Créer/i }));

    await waitFor(() => {
      expect(createGoal).toHaveBeenCalledWith({
        model: 'PLANNED_EXPENSE',
        beneficiaryId: 'ben-loyer-01',
        targetXaf: '300000',
        planId: 'plan-c-monthly',
        durationMonths: 6,
        acceptTermsVersion: TERMS_VERSION,
      });
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('affiche le code métier exact BENEFICIARY_NOT_VERIFIED sur refus serveur', async () => {
    const user = userEvent.setup();
    const createGoal = vi.fn<(input: GoalRequest) => Promise<PlannedExpenseOutcome>>()
      .mockResolvedValue({
        ok: false,
        problem: {
          title: 'Bénéficiaire refusé',
          code: 'BENEFICIARY_NOT_VERIFIED',
          detail: 'Ce bénéficiaire n’est pas vérifié.',
        },
      });

    render(
      <PlannedExpenseForm
        plans={PLANS}
        locale="fr"
        createGoal={createGoal}
      />,
    );

    await user.type(screen.getByLabelText(/Identifiant du bénéficiaire/i), 'ben-inconnu');
    await user.type(screen.getByLabelText(/Montant cible/i), '100000');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Créer/i }));

    expect(await screen.findByText(/BENEFICIARY_NOT_VERIFIED/)).toBeInTheDocument();
  });

  it('reste accessible en français et en anglais (axe-core)', async () => {
    const { container, rerender } = render(
      <PlannedExpenseForm plans={PLANS} locale="fr" />,
    );
    expect((await axe.run(container)).violations).toHaveLength(0);

    rerender(<PlannedExpenseForm plans={PLANS} locale="en" />);
    expect((await axe.run(container)).violations).toHaveLength(0);
  });
});

import type { components } from '@achat/contracts/api';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { randomInt, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { getDictionary } from '../i18n';
import { goalFixture, offerFixture, quoteFixture } from '../test/fixtures';
import type { GoalOutcome } from './goal-start-form';
import { GoalStartForm } from './goal-start-form';

type GoalRequest = components['schemas']['GoalRequest'];
type CreateGoal = (input: GoalRequest) => Promise<GoalOutcome>;

function inputFor(): { offerId: string; quote: ReturnType<typeof quoteFixture> } {
  const offer = offerFixture();
  return {
    offerId: offer.offerId,
    quote: quoteFixture({
      offerId: offer.offerId,
      quoteId: randomUUID(),
      totalXaf: String(50_000 + randomInt(0, 5)),
    }),
  };
}

describe('GoalStartForm', () => {
  it('exige l’acceptation avant tout appel au serveur', async () => {
    const labels = getDictionary('fr').offer;
    const createGoal = vi.fn<CreateGoal>();
    const { container } = render(
      <GoalStartForm {...inputFor()} labels={labels} createGoal={createGoal} />,
    );

    await userEvent.click(screen.getByRole('button', { name: labels.startButton }));

    expect(createGoal).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(labels.termsRequired);
    expect(screen.getByRole('checkbox', { name: labels.termsLabel })).toHaveAttribute('aria-invalid', 'true');
    await expectNoA11yViolations(container);
  });

  it('D32 transmet uniquement le modèle A, l’offre, le plan, la durée et la version acceptée', async () => {
    const labels = getDictionary('fr').offer;
    const input = inputFor();
    const goal = goalFixture({ offerId: input.offerId });
    const createGoal = vi.fn<CreateGoal>(() => Promise.resolve({ ok: true, goal }));
    const onComplete = vi.fn();
    render(
      <GoalStartForm {...input} labels={labels} createGoal={createGoal} onComplete={onComplete} />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: labels.termsLabel }));
    await userEvent.click(screen.getByRole('button', { name: labels.startButton }));

    expect(createGoal).toHaveBeenCalledExactlyOnceWith({
      model: 'SAVE_THEN_BUY',
      offerId: input.offerId,
      planId: input.quote.planId,
      durationMonths: input.quote.durationMonths,
      acceptTermsVersion: '2026-10-26-v1',
    });
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(goal);
  });

  it('D26 un devis du modèle B ne crée aucun objectif (B fermé)', async () => {
    const labels = getDictionary('fr').offer;
    const input = inputFor();
    const createGoal = vi.fn<CreateGoal>();
    render(
      <GoalStartForm
        {...input}
        quote={{ ...input.quote, model: 'FINANCED_PURCHASE' }}
        labels={labels}
        createGoal={createGoal}
      />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: labels.termsLabel }));
    await userEvent.click(screen.getByRole('button', { name: labels.startButton }));
    expect(createGoal).not.toHaveBeenCalled();
    expect(screen.getByText(labels.startErrorTitle)).toBeVisible();
  });

  it('affiche le refus métier exact sans terminer', async () => {
    const labels = getDictionary('fr').offer;
    const createGoal = vi.fn<CreateGoal>(() => Promise.resolve({
      ok: false,
      problem: {
        title: labels.startErrorTitle,
        code: 'CATALOG_PLAN_NOT_APPROVED',
        status: 409,
      },
    }));
    const onComplete = vi.fn();
    render(
      <GoalStartForm {...inputFor()} labels={labels} createGoal={createGoal} onComplete={onComplete} />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: labels.termsLabel }));
    await userEvent.click(screen.getByRole('button', { name: labels.startButton }));

    expect(screen.getByRole('alert')).toHaveTextContent(labels.startErrorTitle);
    expect(screen.getByText('CATALOG_PLAN_NOT_APPROVED', { exact: true })).toBeVisible();
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: labels.startButton })).toBeEnabled();
  });

  it('masque le rejet réseau et libère les contrôles', async () => {
    const labels = getDictionary('fr').offer;
    const internal = `internal-${randomUUID()}`;
    const createGoal = vi.fn<CreateGoal>().mockRejectedValue(new Error(internal));
    const { container } = render(
      <GoalStartForm {...inputFor()} labels={labels} createGoal={createGoal} />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: labels.termsLabel }));
    await userEvent.click(screen.getByRole('button', { name: labels.startButton }));

    expect(screen.getByRole('alert').textContent).toBe(labels.startErrorTitle);
    expect(container.innerHTML).not.toContain(internal);
    expect(screen.getByRole('checkbox', { name: labels.termsLabel })).toBeEnabled();
    expect(screen.getByRole('button', { name: labels.startButton })).toBeEnabled();
  });

  it('refuse les doubles soumissions pendant la création', async () => {
    const labels = getDictionary('fr').offer;
    let complete: ((outcome: GoalOutcome) => void) | undefined;
    const response = new Promise<GoalOutcome>((resolve) => {
      complete = resolve;
    });
    const createGoal = vi.fn<CreateGoal>(() => response);
    const { container } = render(
      <GoalStartForm {...inputFor()} labels={labels} createGoal={createGoal} />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: labels.termsLabel }));
    const form = container.querySelector('form');
    if (form === null) throw new Error('Formulaire absent');

    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(screen.getByRole('button', { name: labels.startButton })).toBeDisabled();
    fireEvent.submit(form);
    expect(createGoal).toHaveBeenCalledTimes(1);

    await act(async () => {
      complete?.({ ok: true, goal: goalFixture() });
      await response;
    });
    await waitFor(() => expect(screen.getByRole('button', { name: labels.startButton })).toBeEnabled());
  });

  it.each(['fr', 'en'] as const)('reste accessible en %s', async (locale) => {
    const labels = getDictionary(locale).offer;
    const { container } = render(<GoalStartForm {...inputFor()} labels={labels} />);
    expect(screen.getByRole('heading', { name: labels.startTitle })).toBeVisible();
    expect(screen.getByRole('link', { name: labels.loginToStart })).toHaveAttribute('href', '/connexion');
    await expectNoA11yViolations(container);
  });
});

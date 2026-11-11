import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { getDictionary } from '../i18n';
import type { PaymentPlan, QuoteLabels, QuoteOutcome } from './quote-panel';
import { QuotePanel } from './quote-panel';
import { offerFixture, quoteFixture } from '../test/fixtures';

const fr = getDictionary('fr');
const labels: QuoteLabels = { ...fr.offer, models: fr.catalog.models };
const offer = offerFixture({
  models: ['SAVE_THEN_BUY', 'FINANCED_PURCHASE'],
});

const PLANS: readonly PaymentPlan[] = [
  { planId: 'plan-a', model: 'SAVE_THEN_BUY', rhythm: 'MONTHLY', minAmountXaf: '5000', maxDurationMonths: 12 },
  { planId: 'plan-a-hebdo', model: 'SAVE_THEN_BUY', rhythm: 'WEEKLY', minAmountXaf: '2000', maxDurationMonths: 6 },
];

describe('QuotePanel', () => {
  it('D26 envoie seulement le plan et la durée, puis affiche la réponse du serveur', async () => {
    const user = userEvent.setup();
    const requestQuote = vi.fn(
      (): Promise<QuoteOutcome> => Promise.resolve({ ok: true, quote: quoteFixture() }),
    );
    const { container } = render(
      <QuotePanel offer={offer} plans={PLANS} labels={labels} locale="fr" requestQuote={requestQuote} />,
    );

    await user.selectOptions(screen.getByLabelText(labels.planLabel), 'plan-a-hebdo');
    await user.clear(screen.getByLabelText(labels.durationLabel));
    await user.type(screen.getByLabelText(labels.durationLabel), '5');
    await user.click(screen.getByRole('button', { name: labels.requestQuote }));

    expect(requestQuote).toHaveBeenCalledWith({ planId: 'plan-a-hebdo', durationMonths: 5 });
    expect(container.textContent).toContain('260\u00a0000\u00a0FCFA');
    expect(container.textContent).toContain('65\u00a0000\u00a0FCFA');
    expect(container.textContent).toContain('15 nov. 2026');
    await expectNoA11yViolations(container);
  });

  it('refuse une durée au-delà de la limite du plan choisi', async () => {
    const user = userEvent.setup();
    const requestQuote = vi.fn((): Promise<QuoteOutcome> => Promise.resolve({ ok: true, quote: quoteFixture() }));
    render(<QuotePanel offer={offer} plans={PLANS} labels={labels} locale="fr" requestQuote={requestQuote} />);
    await user.selectOptions(screen.getByLabelText(labels.planLabel), 'plan-a-hebdo');
    const duration = screen.getByLabelText(labels.durationLabel);
    await user.clear(duration);
    await user.type(duration, '7');
    expect(screen.getByRole('button', { name: labels.requestQuote })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: labels.requestQuote }));
    expect(requestQuote).not.toHaveBeenCalled();
  });

  it('sans plan ouvert : message explicite, aucun formulaire ni montant inventé', () => {
    const { container } = render(<QuotePanel offer={offer} plans={[]} labels={labels} locale="fr" />);
    expect(screen.getByText(labels.noPlans)).toBeVisible();
    expect(screen.queryByRole('button', { name: labels.requestQuote })).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('FCFA');
  });

  it('affiche le problème renvoyé par l’API, sans montant inventé', async () => {
    const user = userEvent.setup();
    const requestQuote = vi.fn(
      (): Promise<QuoteOutcome> => Promise.resolve({
        ok: false,
        problem: { title: 'Plan indisponible', code: 'CATALOG_PLAN_NOT_APPROVED', status: 422 },
      }),
    );
    const { container } = render(
      <QuotePanel offer={offer} plans={PLANS} labels={labels} locale="fr" requestQuote={requestQuote} />,
    );
    await user.click(screen.getByRole('button', { name: labels.requestQuote }));
    expect(screen.getByRole('alert')).toHaveTextContent('Plan indisponible');
    expect(screen.getByText('CATALOG_PLAN_NOT_APPROVED')).toBeVisible();
    // Seul le minimum du plan (donnée serveur) est affiché ; aucun résultat de devis.
    expect(screen.queryByText(labels.total)).not.toBeInTheDocument();
    expect(container.querySelector('.quote-result')).toBeNull();
  });
});

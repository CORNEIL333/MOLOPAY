import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { getDictionary } from '../i18n';
import type { QuoteLabels, QuoteOutcome } from './quote-panel';
import { QuotePanel } from './quote-panel';
import { offerFixture, quoteFixture } from '../test/fixtures';

const fr = getDictionary('fr');
const labels: QuoteLabels = { ...fr.offer, models: fr.catalog.models };
const offer = offerFixture({
  models: ['SAVE_THEN_BUY', 'FINANCED_PURCHASE'],
});

describe('QuotePanel', () => {
  it('envoie seulement les choix au serveur et affiche sa réponse', async () => {
    const user = userEvent.setup();
    const requestQuote = vi.fn(
      (): Promise<QuoteOutcome> => Promise.resolve({ ok: true, quote: quoteFixture() }),
    );
    const { container } = render(
      <QuotePanel
        offer={offer}
        labels={labels}
        locale="fr"
        requestQuote={requestQuote}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText(labels.chooseModel),
      'FINANCED_PURCHASE',
    );
    await user.selectOptions(
      screen.getByLabelText(labels.rhythmLabel),
      'WEEKLY',
    );
    await user.clear(screen.getByLabelText(labels.durationLabel));
    await user.type(screen.getByLabelText(labels.durationLabel), '8');
    await user.click(screen.getByRole('button', { name: labels.requestQuote }));

    expect(requestQuote).toHaveBeenCalledWith({
      model: 'FINANCED_PURCHASE',
      rhythm: 'WEEKLY',
      durationMonths: 8,
    });
    expect(container.textContent).toContain('260\u00a0000\u00a0FCFA');
    expect(container.textContent).toContain('10\u00a0000\u00a0FCFA');
    expect(container.textContent).toContain('65\u00a0000\u00a0FCFA');
    expect(container.textContent).toContain('15 nov. 2026');
    await expectNoA11yViolations(container);
  });

  it('refuse de simuler une durée hors bornes', async () => {
    const user = userEvent.setup();
    const requestQuote = vi.fn(
      (): Promise<QuoteOutcome> => Promise.resolve({ ok: true, quote: quoteFixture() }),
    );
    render(
      <QuotePanel
        offer={offer}
        labels={labels}
        locale="fr"
        requestQuote={requestQuote}
      />,
    );
    const duration = screen.getByLabelText(labels.durationLabel);
    await user.clear(duration);
    await user.type(duration, '40');
    expect(
      screen.getByRole('button', { name: labels.requestQuote }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: labels.requestQuote }));
    expect(requestQuote).not.toHaveBeenCalled();
  });

  it('affiche le problème renvoyé par l’API, sans montant inventé', async () => {
    const user = userEvent.setup();
    const requestQuote = vi.fn(
      (): Promise<QuoteOutcome> => Promise.resolve({
        ok: false,
        problem: {
          title: 'Plan indisponible',
          code: 'CATALOG_PLAN_NOT_APPROVED',
          status: 409,
        },
      }),
    );
    const { container } = render(
      <QuotePanel
        offer={offer}
        labels={labels}
        locale="fr"
        requestQuote={requestQuote}
      />,
    );
    await user.click(screen.getByRole('button', { name: labels.requestQuote }));
    expect(screen.getByRole('alert')).toHaveTextContent('Plan indisponible');
    expect(screen.getByText('CATALOG_PLAN_NOT_APPROVED')).toBeVisible();
    expect(container.textContent).not.toContain('FCFA');
  });
});

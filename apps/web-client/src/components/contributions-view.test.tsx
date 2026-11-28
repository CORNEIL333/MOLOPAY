import type { components } from '@achat/contracts/api';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { getDictionary, LOCALES } from '../i18n';
import { formatDateTime } from '../lib/date';
import { contributionFixture } from '../test/fixtures';
import { ContributionsView } from './contributions-view';

type ContributionList = components['schemas']['ContributionList'];
const asOf = '2026-10-26T18:00:00.000Z';

for (const locale of LOCALES) {
  const labels = getDictionary(locale).goals;

  describe(`ContributionsView (${locale})`, () => {
    it('affiche l’historique daté, les reçus et la fraîcheur serveur', () => {
      const data: ContributionList = {
        contributions: [
          contributionFixture(),
          contributionFixture({
            contributionId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a91',
            amountXaf: '12345',
            receiptNumber: 'REC-2026-0002',
            confirmedAt: '2026-10-24T23:30:00.000Z',
          }),
        ],
        asOf,
      };
      const { container } = render(
        <ContributionsView data={data} labels={labels} locale={locale} />,
      );
      expect(
        screen.getByRole('heading', { level: 2, name: labels.contributionsTitle }),
      ).toBeVisible();
      const items = within(screen.getByRole('list')).getAllByRole('listitem');
      expect(items).toHaveLength(2);
      expect(items.map((item) => item.querySelector('.achat-amount')?.textContent)).toEqual([
        '65\u00a0000\u00a0FCFA',
        '12\u00a0345\u00a0FCFA',
      ]);
      for (const [index, item] of items.entries()) {
        const contribution = data.contributions[index];
        expect(contribution).toBeDefined();
        expect(item).toHaveTextContent(contribution?.receiptNumber ?? '');
        expect(item).toHaveTextContent(labels.receipt);
        expect(
          within(item).getByText(labels.contributionStatuses.CONFIRMED, { exact: true }),
        ).toBeVisible();
        expect(item.querySelector('time')).toHaveAttribute('datetime', contribution?.confirmedAt);
        expect(item.querySelector('time')?.textContent).toBe(
          formatDateTime(contribution?.confirmedAt ?? '', locale),
        );
      }
      expect(screen.queryByText(labels.contributionsEmpty)).not.toBeInTheDocument();
      const freshness = container.querySelector('.data-freshness');
      expect(freshness).toHaveTextContent(labels.asOf);
      expect(freshness?.querySelector('time')).toHaveAttribute('datetime', asOf);
      expect(freshness?.querySelector('time')?.textContent).toBe(formatDateTime(asOf, locale));
    });

    it('affiche un état vide explicite avec la date serveur', () => {
      const { container } = render(
        <ContributionsView data={{ contributions: [], asOf }} labels={labels} locale={locale} />,
      );
      expect(screen.getByRole('heading', { level: 2, name: labels.contributionsTitle })).toBeVisible();
      expect(screen.getByText(labels.contributionsEmpty, { exact: true })).toBeVisible();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
      expect(container.querySelector('.achat-amount')).not.toBeInTheDocument();
      expect(container.querySelector('.data-freshness')).toHaveTextContent(labels.asOf);
      expect(container.querySelector('time')).toHaveAttribute('datetime', asOf);
    });

    it('affiche exactement le statut contre-passé sans le présenter comme confirmé', () => {
      const contribution = contributionFixture({ status: 'REVERSED' });
      render(
        <ContributionsView
          data={{ contributions: [contribution], asOf }}
          labels={labels}
          locale={locale}
        />,
      );
      const item = screen.getByRole('listitem');
      expect(
        within(item).getByText(locale === 'fr' ? 'Contre-passé' : 'Reversed', { exact: true }),
      ).toBeVisible();
      expect(within(item).queryByText(labels.contributionStatuses.CONFIRMED)).not.toBeInTheDocument();
      expect(within(item).queryByText('REVERSED', { exact: true })).not.toBeInTheDocument();
      expect(item).toHaveTextContent(contribution.receiptNumber);
      expect(item.querySelector('.achat-amount')?.textContent).toBe('65\u00a0000\u00a0FCFA');
    });

    it('préserve les montants API exacts, y compris zéro et une contre-passation', () => {
      const { container } = render(
        <ContributionsView
          data={{
            contributions: [
              contributionFixture({ amountXaf: '9223372036854775807', status: 'REVERSED' }),
              contributionFixture({
                contributionId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a91',
                amountXaf: '0',
                receiptNumber: 'REC-2026-0002',
              }),
            ],
            asOf,
          }}
          labels={labels}
          locale={locale}
        />,
      );
      expect(
        Array.from(container.querySelectorAll('.achat-amount'), (node) => node.textContent),
      ).toEqual(['9\u00a0223\u00a0372\u00a0036\u00a0854\u00a0775\u00a0807\u00a0FCFA', '0\u00a0FCFA']);
    });

    it('n’invente pas de date de confirmation absente', () => {
      const contribution = contributionFixture();
      delete contribution.confirmedAt;
      const { container } = render(
        <ContributionsView
          data={{ contributions: [contribution], asOf }}
          labels={labels}
          locale={locale}
        />,
      );
      expect(screen.getByRole('listitem').querySelector('time')).not.toBeInTheDocument();
      expect(screen.getByRole('listitem')).toHaveTextContent(contribution.receiptNumber);
      expect(container.querySelectorAll('time')).toHaveLength(1);
      expect(container.querySelector('time')).toHaveAttribute('datetime', asOf);
    });

    it.each([false, true])('reste accessible, historique vide : %s', async (empty) => {
      const { container } = render(
        <ContributionsView
          data={{
            contributions: empty
              ? []
              : [
                  contributionFixture(),
                  contributionFixture({
                    contributionId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a91',
                    status: 'REVERSED',
                    receiptNumber: 'REC-2026-0002',
                  }),
                ],
            asOf,
          }}
          labels={labels}
          locale={locale}
        />,
      );
      await expectNoA11yViolations(container);
    });
  });
}

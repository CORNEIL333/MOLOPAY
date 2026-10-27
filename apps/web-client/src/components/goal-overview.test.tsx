import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { getDictionary, LOCALES } from '../i18n';
import { formatDate, formatDateTime } from '../lib/date';
import { goalFixture } from '../test/fixtures';
import { GoalOverview } from './goal-overview';

const statuses = ['ACTIVE', 'LOCKED', 'COMPLETED', 'CANCELLED', 'FROZEN'] as const;

for (const locale of LOCALES) {
  const labels = getDictionary(locale).goals;

  describe(`GoalOverview (${locale})`, () => {
    it('affiche le projet, les montants et les dates serveur', () => {
      const goal = goalFixture();
      const { container } = render(
        <GoalOverview goal={goal} labels={labels} locale={locale} />,
      );

      const heading = screen.getByRole('heading', {
        level: 2,
        name: goal.offerTitle,
      });
      expect(within(heading).getByRole('link')).toHaveAttribute(
        'href',
        `/objectifs/${goal.goalId}`,
      );
      expect(screen.getByText(goal.partnerName, { exact: true })).toBeVisible();
      expect(screen.getByText(labels.statuses.ACTIVE, { exact: true })).toBeVisible();
      expect(screen.getByText(labels.target, { exact: true })).toBeVisible();
      expect(screen.getByText(labels.saved, { exact: true })).toBeVisible();
      expect(screen.getByText(labels.installmentAmount, { exact: true })).toBeVisible();
      expect(
        Array.from(container.querySelectorAll('.achat-amount'), (node) => node.textContent),
      ).toEqual(['260\u00a0000\u00a0FCFA', '65\u00a0000\u00a0FCFA', '65\u00a0000\u00a0FCFA']);

      const progress = screen.getByRole('progressbar', { name: labels.progress });
      expect(progress.tagName).toBe('PROGRESS');
      expect(progress).toHaveAttribute('max', '10000');
      expect(progress).toHaveAttribute('value', '2500');
      expect(screen.getByText(labels.nextDue, { exact: true })).toBeVisible();
      const dueDate = screen.getByText(formatDate('2026-11-15', locale));
      expect(dueDate.tagName).toBe('TIME');
      expect(dueDate).toHaveAttribute('datetime', '2026-11-15');
      const freshness = container.querySelector('.data-freshness');
      expect(freshness).toHaveTextContent(labels.asOf);
      expect(freshness?.querySelector('time')).toHaveAttribute('datetime', goal.updatedAt);
      expect(freshness?.querySelector('time')?.textContent).toBe(
        formatDateTime(goal.updatedAt, locale),
      );
    });

    it('encode l’identifiant dans le lien vers le projet', () => {
      render(
        <GoalOverview
          goal={goalFixture({ goalId: 'projet/épargne ?#' })}
          labels={labels}
          locale={locale}
        />,
      );
      expect(screen.getByRole('link')).toHaveAttribute(
        'href',
        '/objectifs/projet%2F%C3%A9pargne%20%3F%23',
      );
    });

    it.each(statuses)('traduit exactement le statut %s', (status) => {
      render(
        <GoalOverview goal={goalFixture({ status })} labels={labels} locale={locale} />,
      );
      expect(screen.getByText(labels.statuses[status], { exact: true })).toBeVisible();
      expect(screen.queryByText(status, { exact: true })).not.toBeInTheDocument();
    });

    it('préserve les grands montants, le versement nul et la progression sans recalcul', () => {
      const { container } = render(
        <GoalOverview
          goal={goalFixture({
            targetXaf: '9223372036854775807',
            savedXaf: '9007199254740993',
            installmentAmountXaf: '0',
            progressBasisPoints: 1234,
          })}
          labels={labels}
          locale={locale}
        />,
      );
      expect(
        Array.from(container.querySelectorAll('.achat-amount'), (node) => node.textContent),
      ).toEqual([
        '9\u00a0223\u00a0372\u00a0036\u00a0854\u00a0775\u00a0807\u00a0FCFA',
        '9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0993\u00a0FCFA',
        '0\u00a0FCFA',
      ]);
      expect(screen.getByRole('progressbar')).toHaveAttribute('value', '1234');
    });

    it.each([0, 10000])('affiche la progression serveur à la borne %s', (progressBasisPoints) => {
      render(
        <GoalOverview
          goal={goalFixture({ progressBasisPoints })}
          labels={labels}
          locale={locale}
        />,
      );
      expect(screen.getByRole('progressbar')).toHaveAttribute('value', String(progressBasisPoints));
    });

    it('n’invente ni montant de versement ni échéance absents', () => {
      const goal = goalFixture({ rhythm: 'FREE' });
      delete goal.installmentAmountXaf;
      delete goal.nextDueDate;
      const { container } = render(
        <GoalOverview goal={goal} labels={labels} locale={locale} />,
      );
      expect(screen.queryByText(labels.installmentAmount)).not.toBeInTheDocument();
      expect(screen.queryByText(labels.nextDue)).not.toBeInTheDocument();
      expect(container.querySelectorAll('.achat-amount')).toHaveLength(2);
      expect(container.querySelectorAll('time')).toHaveLength(1);
      expect(container.querySelector('time')).toHaveAttribute('datetime', goal.updatedAt);
    });

    it('reste accessible avec des labels de progression distincts pour chaque carte', async () => {
      const { container } = render(
        <>
          <GoalOverview goal={goalFixture()} labels={labels} locale={locale} />
          <GoalOverview goal={goalFixture()} labels={labels} locale={locale} />
        </>,
      );
      const progressBars = screen.getAllByLabelText(labels.progress, { exact: true });
      expect(progressBars).toHaveLength(2);
      const ids = progressBars.map((progress) => progress.id);
      expect(ids.every((id) => id !== '')).toBe(true);
      expect(new Set(ids).size).toBe(2);
      await expectNoA11yViolations(container);
    });
  });
}

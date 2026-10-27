import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../test/a11y';
import { Button } from './Button';
import { GoalCard } from './GoalCard';

const baseProps = {
  title: 'Réfrigérateur pour la famille',
  universeLabel: 'Essentiels',
  cityLabel: 'Douala',
  statusLabel: 'En cours',
  targetLabel: 'Objectif',
  targetAmount: '250000',
  progressLabel: 'Progression',
  progressPercent: 40,
  progressValueText: '40 %',
} as const;

describe('GoalCard', () => {
  it('affiche le montant cible formaté et la progression fournie', () => {
    const { container } = render(<GoalCard {...baseProps} />);
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Réfrigérateur pour la famille',
      }),
    ).toBeVisible();
    expect(
      container.querySelector('.achat-goal-card__target')?.textContent,
    ).toBe('250\u00a0000\u00a0FCFA');
    expect(screen.getByText('Essentiels')).toBeVisible();
    expect(screen.getByText('Douala')).toBeVisible();
    expect(screen.getByText('En cours')).toBeVisible();
    expect(
      screen.getByRole('progressbar', { name: 'Progression' }),
    ).toHaveAttribute('aria-valuenow', '40');
  });

  it('accepte un niveau de titre adapté à l’écran', () => {
    render(<GoalCard {...baseProps} headingLevel={3} />);
    expect(
      screen.getByRole('heading', {
        level: 3,
        name: 'Réfrigérateur pour la famille',
      }),
    ).toBeVisible();
  });

  it('expose une action de suivi avec un nom explicite', async () => {
    const user = userEvent.setup();
    const onFollow = vi.fn();
    render(
      <GoalCard
        {...baseProps}
        footer={<Button onClick={onFollow}>Suivre ce projet</Button>}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Suivre ce projet' }),
    );
    expect(onFollow).toHaveBeenCalledTimes(1);
  });

  it('reste accessible avec un statut et une progression', async () => {
    const { container } = render(
      <GoalCard {...baseProps} statusTone="success" />,
    );
    await expectNoA11yViolations(container);
  });
});

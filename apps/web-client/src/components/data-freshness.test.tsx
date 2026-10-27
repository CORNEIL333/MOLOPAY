import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { formatDateTime } from '../lib/date';
import { DataFreshness } from './data-freshness';

describe('DataFreshness', () => {
  it('affiche la date serveur dans un élément time', async () => {
    const asOf = '2026-10-26T18:00:00.000Z';
    const { container } = render(
      <DataFreshness label="Données du" asOf={asOf} locale="fr" />,
    );
    const time = screen.getByText(formatDateTime(asOf, 'fr'));
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', asOf);
    expect(container.textContent).toContain('Données du');
    await expectNoA11yViolations(container);
  });
});

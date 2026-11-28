import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../test/a11y';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('expose la valeur calculée par l’API', () => {
    render(
      <ProgressBar
        percent={42}
        label="Progression des versements"
        valueText="42 %"
      />,
    );
    const bar = screen.getByRole('progressbar', {
      name: 'Progression des versements',
    });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuetext', '42 %');
    expect(bar.firstElementChild).toHaveStyle({ width: '42%' });
  });

  it('rend une barre à 100 % et à 0 %', () => {
    const { rerender } = render(
      <ProgressBar percent={100} label="Progression" />,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    rerender(<ProgressBar percent={0} label="Progression" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
  });

  it('est accessible sans libellé visuel supplémentaire', async () => {
    const { container } = render(
      <ProgressBar percent={75} label="Progression" valueText="75 %" />,
    );
    await expectNoA11yViolations(container);
  });
});

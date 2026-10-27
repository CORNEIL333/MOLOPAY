import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../test/a11y';
import { AmountXaf } from './AmountXaf';

describe('AmountXaf', () => {
  it('affiche le montant renvoyé par l’API en FCFA', () => {
    const { container } = render(<AmountXaf amount="25000" />);
    expect(container.querySelector('.achat-amount')?.textContent).toBe(
      '25\u00a0000\u00a0FCFA',
    );
  });

  it('n’arrondit ni ne convertit un grand montant', () => {
    const { container } = render(<AmountXaf amount="9007199254740993" />);
    expect(container.querySelector('.achat-amount')?.textContent).toBe(
      '9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0993\u00a0FCFA',
    );
  });

  it('accepte un libellé accessible fourni par l’écran', async () => {
    const { container } = render(
      <AmountXaf amount="500000" label="Objectif d’épargne" />,
    );
    const amount = screen.getByLabelText('Objectif d’épargne');
    expect(amount.textContent).toBe('500\u00a0000\u00a0FCFA');
    await expectNoA11yViolations(container);
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../test/a11y';
import { Button } from './Button';

describe('Button', () => {
  it('rend un bouton de formulaire neutre par défaut', () => {
    render(<Button>Continuer</Button>);
    const button = screen.getByRole('button', { name: 'Continuer' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('achat-button--primary');
  });

  it('déclenche l’action au clic', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Payer</Button>);
    await user.click(screen.getByRole('button', { name: 'Payer' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('n’agit pas quand il est désactivé', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Payer
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Payer' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('expose une cible accessible pour une action sensible', async () => {
    const { container } = render(
      <Button variant="danger">Confirmer la remise</Button>,
    );
    expect(screen.getByRole('button')).toHaveClass('achat-button--danger');
    await expectNoA11yViolations(container);
  });
});

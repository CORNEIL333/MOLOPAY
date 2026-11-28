import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../test/a11y';
import { TextArea } from './TextArea';

describe('TextArea', () => {
  it('lie le libellé, l’indice et l’erreur au champ', async () => {
    const { container } = render(
      <TextArea
        id="claim-details"
        label="Précisions"
        hint="Dix caractères minimum."
        error="Trop court."
        value=""
        onChange={() => undefined}
      />,
    );
    const field = screen.getByLabelText('Précisions');
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Dix caractères minimum. Trop court.');
    await expectNoA11yViolations(container);
  });

  it('n’affiche pas de bloc erreur sans erreur', () => {
    render(
      <TextArea
        id="claim-details"
        label="Précisions"
        value=""
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Précisions')).not.toHaveAttribute(
      'aria-invalid',
    );
  });
});

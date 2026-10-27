import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../test/a11y';
import { TextField } from './TextField';

describe('TextField', () => {
  it('associe le libellé au champ et expose l’indice', () => {
    const { container } = render(
      <TextField
        id="phone"
        label="Numéro de téléphone"
        hint="Format +237 6XX XXX XXX"
        inputMode="tel"
        autoComplete="tel"
      />,
    );
    const input = screen.getByLabelText('Numéro de téléphone');
    expect(input).toHaveAttribute('inputmode', 'tel');
    expect(input).toHaveAccessibleDescription('Format +237 6XX XXX XXX');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('annonce l’erreur et marque le champ invalide', () => {
    render(
      <TextField
        id="phone"
        label="Numéro de téléphone"
        hint="Format +237 6XX XXX XXX"
        error="Numéro incomplet"
        value=""
        onChange={() => undefined}
      />,
    );
    const input = screen.getByLabelText('Numéro de téléphone');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(
      'Format +237 6XX XXX XXX Numéro incomplet',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Numéro incomplet');
  });

  it('reste utilisable au clavier avec une erreur affichée', async () => {
    const { container } = render(
      <TextField id="otp" label="Code reçu par SMS" error="Code incorrect" />,
    );
    await expectNoA11yViolations(container);
  });
});

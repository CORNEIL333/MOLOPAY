import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../test/a11y';
import { Button } from './Button';
import { GoalCard } from './GoalCard';
import { VisualEffectsProvider } from './materials';
import {
  AmountChips,
  ChoiceChip,
  CotisationRing,
  IconButton,
  InclusiveAmount,
  MpIcon,
  PinOtpField,
  amountInWords,
  cemacBanknotes,
} from './u1-core';

describe('09_… § 3 · U1a Composants Web cœur, argent et icônes SVG (a11y, mode réduit, M-xx)', () => {
  it('Button (M-01) et IconButton (M-01) : états repos, chargement, actif et refus d’ariaLabel vide', async () => {
    expect(() => render(<IconButton icon="heart" ariaLabel="   " />)).toThrow('ICON_BUTTON_LABEL_REQUIRED');

    const onToggle = vi.fn();
    const { container } = render(
      <div>
        <Button loading>Continuer</Button>
        <IconButton icon="heart" ariaLabel="Ajouter aux favoris" pressed={false} onClick={onToggle} />
        <MpIcon name="search" />
      </div>,
    );

    const btn = screen.getByRole('button', { name: 'Continuer' });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('data-mp-motion', 'M-01');

    const iconBtn = screen.getByRole('button', { name: 'Ajouter aux favoris' });
    expect(iconBtn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.setup().click(iconBtn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    await expectNoA11yViolations(container);
  });

  it('ChoiceChip (M-04) et AmountChips (M-04) : sélection accessible et refus des montants non canoniques', async () => {
    expect(() => render(<AmountChips label="Montant" amounts={['12.5']} value={null} onSelect={vi.fn()} />)).toThrow('XAF_AMOUNT_INVALID');

    const onSelect = vi.fn();
    const { container } = render(
      <div>
        <ChoiceChip pressed onClick={vi.fn()}>Douala</ChoiceChip>
        <AmountChips label="Choisir un montant" amounts={['1000', '5000', '10000']} value="5000" onSelect={onSelect} />
      </div>,
    );

    expect(screen.getByRole('button', { name: 'Douala' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Douala' })).toHaveAttribute('data-mp-motion', 'M-04');
    const fiveK = screen.getByRole('button', { name: /5\s*000\s*FCFA/ });
    expect(fiveK).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().click(screen.getByRole('button', { name: /10\s*000\s*FCFA/ }));
    expect(onSelect).toHaveBeenCalledWith('10000');
    await expectNoA11yViolations(container);
  });

  it('PinOtpField (M-36, M-27) : ne garde que les chiffres ASCII, expose l’erreur et coupe la secousse en mode réduit', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisualEffectsProvider defaultSober>
        <PinOtpField
          id="pin-test"
          label="Code secret à 6 chiffres"
          mode="otp"
          value="1234"
          error="Code incomplet"
          onChange={onChange}
        />
      </VisualEffectsProvider>,
    );

    const input = screen.getByLabelText('Code secret à 6 chiffres');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.closest('[data-mp-motion]')).toHaveAttribute('data-mp-reduced', 'true');
    await userEvent.setup().type(input, 'a5');
    expect(onChange).toHaveBeenLastCalledWith('12345');
    await expectNoA11yViolations(container);
  });

  it('InclusiveAmount (M-21) : 4 représentations (chiffres tabulaires, toutes lettres FR/EN, coupures CEMAC, voix)', async () => {
    expect(amountInWords('25000', 'fr')).toBe('vingt-cinq mille francs CFA');
    expect(amountInWords('25000', 'en')).toBe('twenty-five thousand CFA francs');
    expect(cemacBanknotes('27500')).toEqual([
      { denomination: 10000, count: 2 },
      { denomination: 5000, count: 1 },
      { denomination: 2000, count: 1 },
      { denomination: 500, count: 1 },
    ]);

    const { container } = render(<InclusiveAmount amount="25000" locale="fr" size="lg" />);
    expect(screen.getByText(/25\s*000\s*FCFA/)).toBeVisible();
    expect(screen.getByText('vingt-cinq mille francs CFA')).toBeVisible();
    expect(screen.getByText(/2 × 10 000/)).toBeVisible();
    expect(screen.getByRole('button', { name: /Écouter/i })).toBeVisible();
    expect(container.querySelector('[data-mp-motion="M-21"]')).toHaveAttribute('data-mp-financial', 'true');
    await expectNoA11yViolations(container);
  });

  it('CotisationRing (M-20, M-24) et GoalCard par univers (M-13, M-22) : état icône + mot et mode réduit', async () => {
    const { container } = render(
      <VisualEffectsProvider defaultSober>
        <CotisationRing filled={3} waiting locale="fr" />
        <GoalCard
          title="Moto utilitaire"
          targetXaf="650000"
          savedXaf="325000"
          progressPercent={50}
          universe="mobility"
          statusKind="LOCKED"
          statusLabel="Verrouillé"
        />
      </VisualEffectsProvider>,
    );

    expect(screen.getByLabelText('3 sur 8')).toHaveAttribute('data-mp-waiting', 'false');
    expect(screen.getByText('Verrouillé')).toBeVisible();
    const card = container.querySelector('[data-mp-universe="mobility"]');
    expect(card).not.toBeNull();
    expect(card).toHaveAttribute('data-mp-motion', 'M-13');
    await expectNoA11yViolations(container);
  });
});

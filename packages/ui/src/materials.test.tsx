import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../test/a11y';
import { AmountXaf } from './AmountXaf';
import {
  GlassSurface,
  LiquidBackground,
  SoberEffectsToggle,
  VisualEffectsProvider,
} from './materials';

describe('F8 / M-56 · Matières liquide et verre et repli Sobre', () => {
  afterEach(() => {
    document.documentElement.classList.remove('mp-sober');
    window.localStorage.clear();
  });

  it('LiquidBackground est décoratif (aria-hidden), cite M-56 et se fige sur un écran de saisie ou aurore', async () => {
    const { container, rerender } = render(
      <VisualEffectsProvider>
        <LiquidBackground universe="home" />
      </VisualEffectsProvider>,
    );
    const bg = container.querySelector('[data-mp-motion="M-56"]');
    expect(bg).not.toBeNull();
    expect(bg?.getAttribute('aria-hidden')).toBe('true');
    expect(bg?.getAttribute('data-mp-frozen')).toBe('false');
    await expectNoA11yViolations(container);

    rerender(
      <VisualEffectsProvider>
        <LiquidBackground universe="home" frozen />
      </VisualEffectsProvider>,
    );
    expect(
      container
        .querySelector('[data-mp-motion="M-56"]')
        ?.getAttribute('data-mp-frozen'),
    ).toBe('true');

    rerender(
      <VisualEffectsProvider>
        <LiquidBackground universe="aurora" />
      </VisualEffectsProvider>,
    );
    expect(
      container
        .querySelector('[data-mp-motion="M-56"]')
        ?.getAttribute('data-mp-frozen'),
    ).toBe('true');
  });

  it('bascule en repli Sobre via le réglage Profil (.mp-sober sur html) et reste accessible', async () => {
    const { container } = render(
      <VisualEffectsProvider>
        <SoberEffectsToggle
          label="Effets visuels : sobres"
          description="Retire le flou et fige les dégradés"
        />
        <LiquidBackground universe="technology" />
        <GlassSurface tone="light">
          <span>Navigation</span>
        </GlassSurface>
      </VisualEffectsProvider>,
    );

    const toggle = screen.getByRole('switch', {
      name: 'Effets visuels : sobres',
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(document.documentElement.classList.contains('mp-sober')).toBe(false);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.classList.contains('mp-sober')).toBe(true);
    expect(
      container
        .querySelector('[data-mp-motion="M-56"]')
        ?.getAttribute('data-mp-frozen'),
    ).toBe('true');
    expect(
      container
        .querySelector('[data-mp-glass="light"]')
        ?.getAttribute('data-mp-sober'),
    ).toBe('true');

    await expectNoA11yViolations(container);
  });

  it('refuse plus de 2 surfaces en verre simultanées sur un même écran (MP_GLASS_BUDGET_EXCEEDED)', () => {
    expect(() =>
      render(
        <VisualEffectsProvider>
          <GlassSurface>
            <span>Un</span>
          </GlassSurface>
          <GlassSurface>
            <span>Deux</span>
          </GlassSurface>
          <GlassSurface>
            <span>Trois</span>
          </GlassSurface>
        </VisualEffectsProvider>,
      ),
    ).toThrowError('MP_GLASS_BUDGET_EXCEEDED');
  });

  it('refuse de placer un montant financier sur du verre (MP_GLASS_FINANCIAL_FORBIDDEN)', () => {
    expect(() =>
      render(
        <VisualEffectsProvider>
          <GlassSurface>
            <AmountXaf amount="25000" />
          </GlassSurface>
        </VisualEffectsProvider>,
      ),
    ).toThrowError('MP_GLASS_FINANCIAL_FORBIDDEN');
  });

  it('aucun montant ne change ni ne s’anime tant que la réponse confirmée du serveur n’est pas reçue', () => {
    const { container, rerender } = render(<AmountXaf amount="412500" />);
    const el = container.querySelector('.achat-amount');
    expect(el?.textContent).toBe('412\u00a0500\u00a0FCFA');
    expect(el?.getAttribute('data-mp-financial')).toBe('true');

    // Simule une attente réseau : aucune mise à jour optimiste tant que la prop serveur reste inchangée.
    act(() => {
      rerender(<AmountXaf amount="412500" />);
    });
    expect(container.querySelector('.achat-amount')?.textContent).toBe(
      '412\u00a0500\u00a0FCFA',
    );

    // Réponse serveur confirmée reçue : la valeur affichée passe exactement au nouveau solde serveur.
    act(() => {
      rerender(<AmountXaf amount="417500" />);
    });
    expect(container.querySelector('.achat-amount')?.textContent).toBe(
      '417\u00a0500\u00a0FCFA',
    );
  });
});

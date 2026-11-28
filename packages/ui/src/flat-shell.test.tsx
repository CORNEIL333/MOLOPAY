import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../test/a11y';
import { BrandRing, StatusPill } from './FlatWorkspace';

describe('F7 / H8 / U4 · BrandRing, StatusPill et absence de verre dans les outils plats', () => {
  it('dessine exactement 8 segments arrondis sans inclure le mot-marque dans le SVG', () => {
    const { container } = render(<BrandRing filled={6} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.querySelectorAll('path')).toHaveLength(8);
    expect(svg?.textContent ?? '').not.toMatch(/molopay/i);
  });

  it('borne le nombre de segments remplis entre 0 et 8', () => {
    const { container: zero } = render(<BrandRing filled={-3} tone="dark" />);
    expect(zero.querySelectorAll('path[data-filled="true"]')).toHaveLength(0);

    const { container: full } = render(<BrandRing filled={12} tone="light" />);
    expect(full.querySelectorAll('path[data-filled="true"]')).toHaveLength(8);
  });

  it('rend une pastille de statut point + mot accessible sans surface en verre ni fond liquide', async () => {
    const { container } = render(
      <div className="mp-shell">
        <aside className="mp-side mp-side--dark" aria-label="Outil interne">
          <div className="mp-brand">
            <BrandRing tone="dark" />
            <span>molopay</span>
            <small>Interne</small>
          </div>
        </aside>
        <main className="mp-main">
          <StatusPill tone="ok">Rapproché</StatusPill>
          <StatusPill tone="warn">À valider</StatusPill>
          <StatusPill tone="bad">Hors délai</StatusPill>
        </main>
      </div>,
    );

    expect(screen.getByText('Rapproché')).toBeVisible();
    expect(container.querySelector('.mp-glass')).toBeNull();
    expect(container.querySelector('.mp-liquid')).toBeNull();
    await expectNoA11yViolations(container);
  });
});

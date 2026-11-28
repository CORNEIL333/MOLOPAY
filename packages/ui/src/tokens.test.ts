import { describe, expect, it } from 'vitest';
import { tokens } from './tokens';

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) {
    throw new Error(`Couleur invalide: ${hex}`);
  }
  const [, red, green, blue] = match;
  return (
    0.2126 * channel(Number.parseInt(red ?? '00', 16)) +
    0.7152 * channel(Number.parseInt(green ?? '00', 16)) +
    0.0722 * channel(Number.parseInt(blue ?? '00', 16))
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [light, dark] = a >= b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

type Pair = readonly [name: string, foreground: string, background: string];

const LIGHT_PAIRS: readonly Pair[] = [
  ['texte principal / fond', tokens.color.ink, tokens.color.bg],
  ['texte principal / surface', tokens.color.ink, tokens.color.surface],
  ['texte secondaire / fond', tokens.color.inkMuted, tokens.color.bg],
  ['texte secondaire / surface', tokens.color.inkMuted, tokens.color.surface],
  ['primaire / surface', tokens.color.primary, tokens.color.surface],
  ['primaire / fond', tokens.color.primary, tokens.color.bg],
  ['sur primaire / primaire', tokens.color.onPrimary, tokens.color.primary],
  ['danger / surface', tokens.color.danger, tokens.color.surface],
  ['succès / surface', tokens.color.success, tokens.color.surface],
];

const DARK_PAIRS: readonly Pair[] = [
  ['texte principal / fond', tokens.darkColor.ink, tokens.darkColor.bg],
  ['texte principal / surface', tokens.darkColor.ink, tokens.darkColor.surface],
  ['texte secondaire / fond', tokens.darkColor.inkMuted, tokens.darkColor.bg],
  [
    'texte secondaire / surface',
    tokens.darkColor.inkMuted,
    tokens.darkColor.surface,
  ],
  ['primaire / fond', tokens.darkColor.primary, tokens.darkColor.bg],
  ['primaire / surface', tokens.darkColor.primary, tokens.darkColor.surface],
  [
    'sur primaire / primaire',
    tokens.darkColor.onPrimary,
    tokens.darkColor.primary,
  ],
  ['danger / fond', tokens.darkColor.danger, tokens.darkColor.bg],
  ['succès / fond', tokens.darkColor.success, tokens.darkColor.bg],
];

describe('jetons de design — contraste WCAG 2.2 AA', () => {
  it.each(LIGHT_PAIRS)('clair : %s ≥ 4.5:1', (_name, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(DARK_PAIRS)('sombre : %s ≥ 4.5:1', (_name, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('réserve une cible tactile d’au moins 44 px', () => {
    expect(tokens.touchTarget).toBe('44px');
  });

  it('borne la largeur de lecture pour rester lisible sur grand écran', () => {
    expect(tokens.maxContentWidth).toBe('72rem');
  });
});

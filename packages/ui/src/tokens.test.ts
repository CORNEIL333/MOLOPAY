import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { molopayTokens, tokens } from './tokens';

const REPO_ROOT = resolve(__dirname, '../../..');

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
  [
    'texte secondaire verre / fond brume',
    molopayTokens.glassLightTextSecondary,
    molopayTokens.colorMist,
  ],
  [
    'attention / fond attention',
    molopayTokens.colorStatusWarning,
    molopayTokens.colorStatusWarningBg,
  ],
  [
    'danger / fond danger',
    molopayTokens.colorStatusDanger,
    molopayTokens.colorStatusDangerBg,
  ],
  [
    'succès / fond succès',
    molopayTokens.colorStatusSuccess,
    molopayTokens.colorStatusSuccessBg,
  ],
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

const UNIVERSE_PAIRS: readonly Pair[] = [
  [
    'encre / essentiels (citron)',
    molopayTokens.colorInk,
    molopayTokens.colorUniverseEssentials,
  ],
  [
    'encre / technologie (ciel)',
    molopayTokens.colorInk,
    molopayTokens.colorUniverseTechnology,
  ],
  [
    'encre / logement (lilas)',
    molopayTokens.colorInk,
    molopayTokens.colorUniverseHousing,
  ],
  [
    'encre / mobilité (hibiscus)',
    molopayTokens.colorInk,
    molopayTokens.colorUniverseMobility,
  ],
];

describe('NF-UX-001 · jetons de design MoloPay — contraste WCAG 2.2 AA et identité U0', () => {
  it('applique la base noir et blanc (#0f1012 / #ffffff / #f2f2ee)', () => {
    expect(tokens.color.ink).toBe('#0f1012');
    expect(tokens.color.primary).toBe('#0f1012');
    expect(tokens.color.surface).toBe('#ffffff');
    expect(tokens.color.bg).toBe('#f2f2ee');
    expect(tokens.darkColor.primary).toBe('#ffffff');
    expect(tokens.darkColor.onPrimary).toBe('#0f1012');
  });

  it.each(LIGHT_PAIRS)('clair : %s ≥ 4.5:1', (_name, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(DARK_PAIRS)('sombre : %s ≥ 4.5:1', (_name, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UNIVERSE_PAIRS)(
    'univers en aplat sous texte noir : %s ≥ 10.5:1 (AAA)',
    (_name, foreground, background) => {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(10.5);
    },
  );

  it('refuse : les couleurs d’univers échouent (< 4.5:1) comme texte sur papier blanc', () => {
    for (const universeHex of [
      molopayTokens.colorUniverseEssentials,
      molopayTokens.colorUniverseTechnology,
      molopayTokens.colorUniverseHousing,
      molopayTokens.colorUniverseMobility,
    ]) {
      expect(
        contrastRatio(universeHex, molopayTokens.colorPaper),
      ).toBeLessThan(2);
    }
  });

  it('réserve une cible tactile d’au moins 44 px et un bouton pilule de 48 px', () => {
    expect(tokens.touchTarget).toBe('44px');
    expect(molopayTokens.sizeButtonHeight).toBe('48px');
  });

  it('borne la largeur de lecture pour rester lisible sur grand écran', () => {
    expect(tokens.maxContentWidth).toBe('72rem');
  });

  it('embarque Outfit et Inter localement avec licences SIL OFL et sommes SHA-256 exactes', () => {
    const expectedFonts: ReadonlyArray<readonly [string, string]> = [
      [
        'packages/ui/fonts/Outfit-Variable.ttf',
        'fc7287273e66929776e2ba54f144fe699080bec29f61bf649d70d871468aeade',
      ],
      [
        'packages/ui/fonts/OFL-Outfit.txt',
        'c676351bf8576b9aba743cd5eaa8c0e7ee0d51f805d720447b4df4ddb6a2e416',
      ],
      [
        'packages/ui/fonts/Inter-Variable.ttf',
        '29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031',
      ],
      [
        'packages/ui/fonts/OFL-Inter.txt',
        '5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57',
      ],
    ];
    for (const [relPath, expectedSha] of expectedFonts) {
      const fullPath = resolve(REPO_ROOT, relPath);
      expect(existsSync(fullPath), relPath).toBe(true);
      const sha = createHash('sha256')
        .update(readFileSync(fullPath))
        .digest('hex');
      expect(sha, relPath).toBe(expectedSha);
    }
  });

  it('refuse toute référence à l’ancienne palette (0b6b53, e4a11b, f16b27) et à Google Fonts hors historique', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], {
      cwd: REPO_ROOT,
      encoding: 'buffer',
    })
      .toString('utf8')
      .split('\0')
      .filter(
        (f) =>
          f.length > 0 &&
          !f.startsWith('docs/journal/') &&
          f !== 'packages/ui/src/tokens.test.ts' &&
          /\.(?:ts|tsx|css|dart|xml|svg|webmanifest|html)$/.test(f),
      );

    const legacyPalette = /0b6b53|e4a11b|f16b27/i;
    const runtimeGoogleFonts = /fonts\.googleapis\.com|fonts\.gstatic\.com/i;
    const offenders: string[] = [];

    for (const file of tracked) {
      const content = readFileSync(resolve(REPO_ROOT, file), 'utf8');
      if (legacyPalette.test(content)) {
        offenders.push(`palette:${file}`);
      }
      if (runtimeGoogleFonts.test(content)) {
        offenders.push(`google-fonts:${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

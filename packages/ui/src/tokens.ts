import { molopayTokens, type MolopayTokens } from './tokens.generated';

export { molopayTokens };
export type { MolopayTokens };

export const tokens = {
  color: {
    bg: molopayTokens.colorMist,
    surface: molopayTokens.colorPaper,
    surfaceMuted: molopayTokens.colorMist2,
    ink: molopayTokens.colorInk,
    inkMuted: molopayTokens.colorMuted,
    primary: molopayTokens.colorInk,
    primaryStrong: molopayTokens.colorInk2,
    onPrimary: molopayTokens.colorPaper,
    accent: molopayTokens.colorUniverseEssentials,
    danger: molopayTokens.colorStatusDanger,
    success: molopayTokens.colorStatusSuccess,
    warning: molopayTokens.colorStatusWarning,
    border: molopayTokens.colorMist2,
    focus: molopayTokens.colorInk,
  },
  darkColor: {
    bg: molopayTokens.colorDarkBg,
    surface: molopayTokens.colorDarkSurface,
    surfaceMuted: molopayTokens.colorDarkSurface2,
    ink: molopayTokens.colorDarkText,
    inkMuted: molopayTokens.colorMutedDark,
    primary: molopayTokens.colorPaper,
    primaryStrong: molopayTokens.colorDarkText,
    onPrimary: molopayTokens.colorInk,
    accent: molopayTokens.colorUniverseEssentials,
    danger: molopayTokens.colorStatusDangerBg,
    success: molopayTokens.colorStatusSuccessBg,
    warning: molopayTokens.colorStatusWarningBg,
    border: molopayTokens.colorDarkLine,
    focus: molopayTokens.colorUniverseEssentials,
  },
  universe: {
    essentials: molopayTokens.colorUniverseEssentials,
    technology: molopayTokens.colorUniverseTechnology,
    housing: molopayTokens.colorUniverseHousing,
    mobility: molopayTokens.colorUniverseMobility,
  },
  space: {
    xs: molopayTokens.space1,
    sm: molopayTokens.space2,
    md: molopayTokens.space3,
    lg: molopayTokens.space4,
    xl: molopayTokens.space5,
    xxl: molopayTokens.space6,
    xxxl: molopayTokens.space7,
  },
  radius: {
    sm: molopayTokens.radiusSm,
    md: molopayTokens.radiusMd,
    lg: molopayTokens.radiusLg,
    xl: molopayTokens.radiusXl,
    pill: molopayTokens.radiusPill,
  },
  fontSize: {
    xs: molopayTokens.fontSizeXs,
    sm: molopayTokens.fontSizeMd,
    md: molopayTokens.fontSizeLg,
    lg: molopayTokens.fontSizeXl,
    xl: molopayTokens.fontSize2xl,
    xxl: molopayTokens.fontSizeAmount,
  },
  lineHeight: { tight: '1.2', normal: '1.5', relaxed: '1.65' },
  fontFamily: {
    display: molopayTokens.fontFamilyDisplay.join(', '),
    sans: molopayTokens.fontFamilyText.join(', '),
    mono: "'Cascadia Mono', 'SFMono-Regular', Consolas, monospace",
  },
  touchTarget: molopayTokens.sizeTouchTarget,
  buttonHeight: molopayTokens.sizeButtonHeight,
  maxContentWidth: '72rem',
} as const;

export type Tokens = typeof tokens;

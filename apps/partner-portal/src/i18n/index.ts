import { en } from './en';
import { fr, type Dictionary } from './fr';

export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export type { Dictionary };

export function isLocale(value: string | undefined | null): value is Locale {
  return value === 'fr' || value === 'en';
}

export function getDictionary(locale: Locale): Dictionary {
  return locale === 'en' ? en : fr;
}

/** Cookie explicite prioritaire, sinon première langue reconnue du navigateur (qualité décroissante), sinon français. */
export function resolveLocale(cookieValue: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...parameters] = part.trim().split(';');
      const quality = parameters.map((parameter) => /^q=([0-9.]+)$/.exec(parameter.trim())?.[1]).find((value) => value !== undefined);
      const parsed = quality === undefined ? 1 : Number(quality);
      return { tag: tag.trim().toLowerCase(), quality: Number.isFinite(parsed) ? parsed : 0 };
    })
    .filter((item) => item.tag !== '')
    .sort((left, right) => right.quality - left.quality);
  for (const { tag } of ranked) {
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
    if (tag === 'fr' || tag.startsWith('fr-')) return 'fr';
  }
  return 'fr';
}

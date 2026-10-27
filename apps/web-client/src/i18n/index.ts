import { en } from './en';
import { fr } from './fr';
import type { Dictionary } from './fr';

export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(value: string | undefined | null): value is Locale {
  return value === 'fr' || value === 'en';
}

type RankedLanguage = { readonly tag: string; readonly quality: number };

function parseAcceptLanguage(header: string | null): RankedLanguage[] {
  if (header === null) {
    return [];
  }
  const ranked: RankedLanguage[] = [];
  for (const part of header.split(',')) {
    const [rawTag, ...parameters] = part.trim().split(';');
    const tag = rawTag?.trim().toLowerCase();
    if (tag === undefined || tag === '') {
      continue;
    }
    let quality = 1;
    for (const parameter of parameters) {
      const match = /^q=([0-9.]+)$/.exec(parameter.trim());
      if (match?.[1] !== undefined) {
        const parsed = Number(match[1]);
        quality = Number.isFinite(parsed) ? parsed : 0;
      }
    }
    ranked.push({ tag, quality });
  }
  return ranked.sort((left, right) => right.quality - left.quality);
}

/**
 * Cookie explicite prioritaire, sinon langue du navigateur, sinon français.
 * Aucune redirection : la langue ne change pas l'URL des écrans.
 */
export function resolveLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | null,
): Locale {
  if (isLocale(cookieValue)) {
    return cookieValue;
  }
  for (const { tag } of parseAcceptLanguage(acceptLanguage)) {
    if (tag === 'en' || tag.startsWith('en-')) {
      return 'en';
    }
    if (tag === 'fr' || tag.startsWith('fr-')) {
      return 'fr';
    }
  }
  return 'fr';
}

export function getDictionary(locale: Locale): Dictionary {
  return locale === 'en' ? en : fr;
}

export type { Dictionary };

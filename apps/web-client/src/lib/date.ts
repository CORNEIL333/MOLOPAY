import type { Locale } from '../i18n';

const TIME_ZONE = 'Africa/Douala';

function toDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localeTag(locale: Locale): string {
  return locale === 'en' ? 'en-CM' : 'fr-CM';
}

export function formatDate(iso: string, locale: Locale): string {
  const date = toDate(iso);
  if (date === null) {
    return '';
  }
  return new Intl.DateTimeFormat(localeTag(locale), {
    dateStyle: 'medium',
    timeZone: TIME_ZONE,
  }).format(date);
}

export function formatDateTime(iso: string, locale: Locale): string {
  const date = toDate(iso);
  if (date === null) {
    return '';
  }
  return new Intl.DateTimeFormat(localeTag(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: TIME_ZONE,
  }).format(date);
}

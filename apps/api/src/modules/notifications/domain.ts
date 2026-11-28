import { BusinessError } from '@achat/contracts';

export const NOTIFICATION_EVENTS = [
  'PAYMENT_CONFIRMED', 'PAYMENT_REMINDER', 'GOAL_FUNDED',
  'HANDOVER_READY', 'SETTLEMENT_CONFIRMED', 'DISPUTE_UPDATED',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export type NotificationMessage = Readonly<{ title: string; body: string }>;

/** Textes génériques à valider humainement ; aucun champ libre ni donnée personnelle. */
const TEMPLATES: Readonly<Record<NotificationEvent, Readonly<Record<'fr' | 'en', NotificationMessage>>>> = {
  PAYMENT_CONFIRMED: {
    fr: { title: 'Versement confirmé', body: 'Votre versement est confirmé. Consultez votre reçu dans Molopay.' },
    en: { title: 'Payment confirmed', body: 'Your payment is confirmed. View your receipt in Molopay.' },
  },
  PAYMENT_REMINDER: {
    fr: { title: 'Rappel d’échéance', body: 'Une échéance approche. Consultez votre projet dans Molopay.' },
    en: { title: 'Payment reminder', body: 'A payment date is approaching. View your plan in Molopay.' },
  },
  GOAL_FUNDED: {
    fr: { title: 'Objectif atteint', body: 'Votre objectif est intégralement financé. Consultez la suite dans Molopay.' },
    en: { title: 'Goal reached', body: 'Your goal is fully funded. View the next steps in Molopay.' },
  },
  HANDOVER_READY: {
    fr: { title: 'Remise disponible', body: 'Votre code de remise est disponible dans Molopay. Gardez-le confidentiel.' },
    en: { title: 'Handover ready', body: 'Your handover code is available in Molopay. Keep it confidential.' },
  },
  SETTLEMENT_CONFIRMED: {
    fr: { title: 'Règlement confirmé', body: 'Un règlement est confirmé. Consultez les détails dans Molopay.' },
    en: { title: 'Settlement confirmed', body: 'A settlement is confirmed. View the details in Molopay.' },
  },
  DISPUTE_UPDATED: {
    fr: { title: 'Suivi de votre litige', body: 'Votre dossier de litige a été mis à jour. Consultez Molopay.' },
    en: { title: 'Dispute update', body: 'Your dispute has been updated. View the details in Molopay.' },
  },
};

function invalid(): never {
  throw new BusinessError('NOTIFICATION_INVALID_REQUEST', 'Paramètres de notification invalides');
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}

/** F-NOT-001/002 : aucun montant, nom, PIN, OTP, URL ou identifiant interpolé. */
export function renderNotification(input: unknown): NotificationMessage {
  const request = exactRecord(input, ['event', 'locale', 'channel']);
  if (typeof request['event'] !== 'string' || !(NOTIFICATION_EVENTS as readonly string[]).includes(request['event'])) invalid();
  if (request['locale'] !== 'fr' && request['locale'] !== 'en') invalid();
  if (request['channel'] !== 'SMS' && request['channel'] !== 'PUSH') invalid();
  return Object.freeze({ ...TEMPLATES[request['event'] as NotificationEvent][request['locale']] });
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
}

/**
 * F-NOT-003 : décision pure, sans réservation ni envoi. L'historique doit être
 * complet pour le destinataire (tous canaux/projets), lu par le serveur. Le futur
 * travailleur devra vérifier et réserver atomiquement avant tout envoi réel.
 * Plage locale [début, fin[ ; fenêtre glissante ]now - windowMs, now].
 */
export function assertReminderAllowed(input: unknown): void {
  const request = exactRecord(input, ['now', 'policy', 'previousSentAt']);
  const policy = exactRecord(request['policy'], ['timeZone', 'startMinute', 'endMinute', 'maxCount', 'windowMs']);
  const now = request['now'];
  const previous = request['previousSentAt'];
  if (!timestamp(now) || !Array.isArray(previous)
    || !Array.from(previous as unknown[]).every((value: unknown) => timestamp(value) && value <= now)) invalid();
  const start = policy['startMinute'];
  const end = policy['endMinute'];
  const limit = policy['maxCount'];
  const windowMs = policy['windowMs'];
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 0 || start >= 1440) invalid();
  if (typeof end !== 'number' || !Number.isInteger(end) || end < 0 || end >= 1440 || end === start) invalid();
  if (!positiveInteger(limit) || !positiveInteger(windowMs) || typeof policy['timeZone'] !== 'string' || policy['timeZone'] === '') invalid();
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: policy['timeZone'], hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
  } catch { invalid(); }
  const minute = Number(parts.find((part) => part.type === 'hour')?.value) * 60
    + Number(parts.find((part) => part.type === 'minute')?.value);
  if (!Number.isInteger(minute) || minute < 0 || minute >= 1440) invalid();
  const inside = start < end ? minute >= start && minute < end : minute >= start || minute < end;
  if (!inside) throw new BusinessError('NOTIFICATION_OUTSIDE_WINDOW', 'Rappel hors plage autorisée');
  const count = (previous as number[]).filter((sentAt) => sentAt > now - windowMs).length;
  if (count >= limit) throw new BusinessError('NOTIFICATION_RATE_LIMITED', 'Fréquence maximale des rappels atteinte');
}

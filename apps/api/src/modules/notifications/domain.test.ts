import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import { assertReminderAllowed, renderNotification } from './domain';

const EVENTS = ['PAYMENT_CONFIRMED', 'PAYMENT_REMINDER', 'GOAL_FUNDED', 'HANDOVER_READY', 'SETTLEMENT_CONFIRMED', 'DISPUTE_UPDATED'];
const NOW = Date.parse('2026-11-03T10:00:00Z'); // 11 h à Douala.
const POLICY = { timeZone: 'Africa/Douala', startMinute: 480, endMinute: 1200, maxCount: 2, windowMs: 86_400_000 };

function refuses(action: () => unknown, code: string): BusinessError {
  let caught: unknown;
  try { action(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(BusinessError);
  expect((caught as BusinessError).code).toBe(code);
  return caught as BusinessError;
}

describe('F-NOT-001/002 gabarits fermés', () => {
  for (const event of EVENTS) {
    for (const locale of ['fr', 'en']) {
      for (const channel of ['SMS', 'PUSH']) {
        it(`${event} ${locale} ${channel} sans donnée personnelle`, () => {
          const message = renderNotification({ event, locale, channel });
          expect(message.title.length).toBeGreaterThan(0);
          expect(message.body.length).toBeGreaterThan(0);
          expect(message.body).not.toMatch(/[0-9]{4,}|\+237|https?:|\{\{/);
          expect(Object.isFrozen(message)).toBe(true);
        });
      }
    }
  }
  it('F-NOT-001 utilise des textes distincts FR/EN', () => {
    expect(renderNotification({ event: EVENTS[0], locale: 'fr', channel: 'SMS' }).body)
      .not.toBe(renderNotification({ event: EVENTS[0], locale: 'en', channel: 'SMS' }).body);
  });
  for (const input of [null, [], {}, { event: 'UNKNOWN', locale: 'fr', channel: 'SMS' }, { event: EVENTS[0], locale: 'xx', channel: 'SMS' }, { event: EVENTS[0], locale: 'fr', channel: 'EMAIL' }]) {
    it('F-NOT-001 refuse une requête invalide', () => {
      refuses(() => renderNotification(input), 'NOTIFICATION_INVALID_REQUEST');
    });
  }
  for (const field of ['pin', 'otp', 'phone', 'name', 'identityDocument', 'body', 'amount', 'url']) {
    it(`F-NOT-002 refuse le champ ${field} sans recopier sa valeur`, () => {
      const error = refuses(() => renderNotification({ event: EVENTS[0], locale: 'fr', channel: 'SMS', [field]: 'contenu interdit' }), 'NOTIFICATION_INVALID_REQUEST');
      expect(error.message).not.toContain('contenu interdit');
    });
  }
});

describe('F-NOT-003 rappels', () => {
  const input = { now: NOW, policy: POLICY, previousSentAt: [] as number[] };
  it('accepte dans la plage locale avec quota disponible', () => {
    expect(() => assertReminderAllowed(input)).not.toThrow();
  });
  it('accepte exactement au début', () => {
    expect(() => assertReminderAllowed({ ...input, now: Date.parse('2026-11-03T07:00:00Z') })).not.toThrow();
  });
  it('refuse exactement à la fin', () => {
    refuses(() => assertReminderAllowed({ ...input, now: Date.parse('2026-11-03T19:00:00Z') }), 'NOTIFICATION_OUTSIDE_WINDOW');
  });
  it('refuse avant le début', () => {
    refuses(() => assertReminderAllowed({ ...input, now: Date.parse('2026-11-03T06:59:00Z') }), 'NOTIFICATION_OUTSIDE_WINDOW');
  });
  it('gère une plage traversant minuit', () => {
    const policy = { ...POLICY, startMinute: 1320, endMinute: 120 };
    expect(() => assertReminderAllowed({ ...input, policy, now: Date.parse('2026-11-03T23:00:00Z') })).not.toThrow();
    refuses(() => assertReminderAllowed({ ...input, policy }), 'NOTIFICATION_OUTSIDE_WINDOW');
  });
  it('refuse au plafond, y compris les envois de cet instant', () => {
    refuses(() => assertReminderAllowed({ ...input, previousSentAt: [NOW - 1000, NOW] }), 'NOTIFICATION_RATE_LIMITED');
  });
  it('exclut la borne passée de la fenêtre glissante', () => {
    expect(() => assertReminderAllowed({ ...input, previousSentAt: [NOW - POLICY.windowMs, NOW - 1000] })).not.toThrow();
  });
  it('refuse un historique incomplet avec des cases vides', () => {
    refuses(() => assertReminderAllowed({ ...input, previousSentAt: new Array<number>(2) }), 'NOTIFICATION_INVALID_REQUEST');
  });
  it('utilise le fuseau configuré avec ses changements de décalage', () => {
    const policy = { ...POLICY, timeZone: 'Europe/Paris', startMinute: 600, endMinute: 660 };
    expect(() => assertReminderAllowed({ ...input, policy, now: Date.parse('2026-07-01T08:00:00Z') })).not.toThrow();
    expect(() => assertReminderAllowed({ ...input, policy, now: Date.parse('2026-11-03T09:00:00Z') })).not.toThrow();
    refuses(() => assertReminderAllowed({ ...input, policy, now: Date.parse('2026-11-03T08:00:00Z') }), 'NOTIFICATION_OUTSIDE_WINDOW');
  });
  for (const policy of [null, {}, { ...POLICY, timeZone: 'invalid/zone' }, { ...POLICY, maxCount: 0 }, { ...POLICY, maxCount: 1.5 }, { ...POLICY, windowMs: -1 }, { ...POLICY, startMinute: 1440 }, { ...POLICY, endMinute: -1 }, { ...POLICY, startMinute: POLICY.endMinute }, { ...POLICY, other: true }]) {
    it('refuse une politique absente, ambiguë ou invalide', () => {
      refuses(() => assertReminderAllowed({ ...input, policy }), 'NOTIFICATION_INVALID_REQUEST');
    });
  }
  for (const patch of [{ now: NaN }, { now: Infinity }, { now: -1 }, { previousSentAt: [NOW + 1] }, { previousSentAt: [NaN] }, { previousSentAt: 'invalid' }, { extra: true }]) {
    it('refuse horloge, historique ou champ invalide', () => {
      refuses(() => assertReminderAllowed({ ...input, ...patch }), 'NOTIFICATION_INVALID_REQUEST');
    });
  }
});

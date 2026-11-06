import { describe, expect, it } from 'vitest';
import { BusinessError } from '@achat/contracts';
import { parseNotificationEnvelope } from './outbox.store';

const ENVELOPE = { recipientId: '019a9400-0000-7000-8000-0000000000a1', eventKey: '019a9400-0000-7000-8000-0000000000b1', event: 'PAYMENT_CONFIRMED', locale: 'fr', channel: 'SMS' };
describe('F-NOT-002 enveloppe fermée', () => {
  it('refuse un accesseur sans lire son contenu', () => {
    let read = false;
    const value = { ...ENVELOPE };
    Object.defineProperty(value, 'event', { get: () => { read = true; return 'PAYMENT_CONFIRMED'; }, enumerable: true });
    let failure: unknown;
    try { parseNotificationEnvelope(value); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(BusinessError);
    expect(failure).toMatchObject({ code: 'NOTIFICATION_INVALID_REQUEST' });
    expect(read).toBe(false);
  });
  it('accepte une enveloppe immuable sans garder de référence mutable', () => {
    const value = { ...ENVELOPE };
    const parsed = parseNotificationEnvelope(value);
    value.locale = 'en';
    expect(parsed.locale).toBe('fr'); expect(Object.isFrozen(parsed)).toBe(true);
  });
  for (const input of [null, {}, [], { ...ENVELOPE, recipientId: 'invalid' }, { ...ENVELOPE, eventKey: '' }, { ...ENVELOPE, event: 'UNKNOWN' }, { ...ENVELOPE, locale: 'de' }, { ...ENVELOPE, channel: 'EMAIL' },
    ...['body', 'phone', 'pin', 'otp', 'identity', 'url'].map((key) => ({ ...ENVELOPE, [key]: 'contenu interdit' }))]) {
    it('refuse les valeurs invalides et données libres sans les journaliser', () => {
      let failure: unknown;
      try { parseNotificationEnvelope(input); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(BusinessError);
      expect((failure as BusinessError).code).toBe('NOTIFICATION_INVALID_REQUEST');
      expect((failure as Error).message).not.toContain('contenu interdit');
    });
  }
});

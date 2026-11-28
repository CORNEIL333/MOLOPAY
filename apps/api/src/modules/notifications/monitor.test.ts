import { describe, expect, it } from 'vitest';
import { assessNotificationQueue } from './monitor';
import type { DispatchCounts } from './dispatch.store';

const COUNTS: DispatchCounts = { pending: 2n, leased: 3n, retryWait: 4n, exhausted: 0n, deferredReminders: 1n };
const LIMITS = { maxPending: 2n, maxDeferredReminders: 1n };
describe('NF-REL-005 · évaluation de supervision', () => {
  it('accepte les limites exactes et rend seulement des compteurs décimaux', () => {
    expect(assessNotificationQueue(COUNTS, LIMITS)).toEqual({ status: 'OK', reasons: [],
      counts: { pending: '2', leased: '3', retryWait: '4', exhausted: '0', deferredReminders: '1' } });
  });
  it('signale tous les motifs applicables dans un ordre stable', () => {
    expect(assessNotificationQueue({ ...COUNTS, pending: 3n, exhausted: 1n, deferredReminders: 2n }, LIMITS))
      .toMatchObject({ status: 'ATTENTION', reasons: ['NOTIFICATION_QUEUE_EXHAUSTED', 'NOTIFICATION_QUEUE_BACKLOG', 'NOTIFICATION_REMINDERS_DEFERRED'] });
  });
  it('ne convertit jamais les grands compteurs en flottants', () => {
    const value = 9007199254740993n;
    expect(assessNotificationQueue({ ...COUNTS, pending: value }, { ...LIMITS, maxPending: value - 1n }))
      .toMatchObject({ status: 'ATTENTION', counts: { pending: '9007199254740993' } });
  });
  for (const key of Object.keys(COUNTS) as (keyof DispatchCounts)[]) {
    for (const value of [-1n, 1, undefined]) {
      it(`refuse le compteur invalide ${key} avec le code exact`, () => {
        expect(() => assessNotificationQueue({ ...COUNTS, [key]: value }, LIMITS))
          .toThrow(expect.objectContaining({ code: 'NOTIFICATION_INVALID_REQUEST' }));
      });
    }
  }
  it('refuse les seuils invalides et ne modifie pas les entrées', () => {
    expect(() => assessNotificationQueue(COUNTS, { maxPending: -1n, maxDeferredReminders: 0n }))
      .toThrow(expect.objectContaining({ code: 'NOTIFICATION_INVALID_REQUEST' }));
    expect(() => assessNotificationQueue(COUNTS, { maxPending: 0n } as typeof LIMITS))
      .toThrow(expect.objectContaining({ code: 'NOTIFICATION_INVALID_REQUEST' }));
    assessNotificationQueue(Object.freeze(COUNTS), Object.freeze(LIMITS));
    expect(COUNTS.pending).toBe(2n);
  });
  it('refuse les champs libres et les accesseurs sans les évaluer', () => {
    const extra = { ...COUNTS, recipient: 'interdit' };
    expect(() => assessNotificationQueue(extra, LIMITS))
      .toThrow(expect.objectContaining({ code: 'NOTIFICATION_INVALID_REQUEST' }));
    let accessed = false;
    const counts = { ...COUNTS };
    Object.defineProperty(counts, 'pending', { get: () => { accessed = true; return 0n; } });
    expect(() => assessNotificationQueue(counts, LIMITS)).toThrow(expect.objectContaining({ code: 'NOTIFICATION_INVALID_REQUEST' }));
    expect(accessed).toBe(false);
  });
});

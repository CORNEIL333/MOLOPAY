import { BusinessError } from '@achat/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluateRule, parseRiskThresholds, RISK_RULES, type RiskEvent, type RiskThresholds } from './domain';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const MINUTE = 60_000;
const THRESHOLDS: RiskThresholds = {
  PAYMENT_VELOCITY: { maxCount: 3, windowMinutes: 60 },
  REPEATED_CANCELLATIONS: { maxCount: 2, windowMinutes: 30 * 24 * 60 },
  HANDOVER_SPIKE: { maxCount: 20, windowMinutes: 24 * 60 },
};

function refuses(action: () => unknown, code: string): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BusinessError);
  expect((caught as BusinessError).code).toBe(code);
}

function events(minutesAgo: readonly number[]): RiskEvent[] {
  return minutesAgo.map((ago, index) => ({ id: `019a9f00-0000-7000-8000-${index.toString().padStart(12, '0')}`, at: NOW - ago * MINUTE }));
}

describe('SEC-FRD-001 seuils publiés, fermés par défaut', () => {
  it('accepte exactement les trois règles avec des bornes entières', () => {
    expect(parseRiskThresholds(THRESHOLDS)).toEqual(THRESHOLDS);
    expect(Object.isFrozen(parseRiskThresholds(THRESHOLDS))).toBe(true);
  });

  it('paramètre absent : détection refusée (RISK_SETTINGS_NOT_CONFIGURED)', () => {
    refuses(() => parseRiskThresholds(null), 'RISK_SETTINGS_NOT_CONFIGURED');
    refuses(() => parseRiskThresholds(undefined), 'RISK_SETTINGS_NOT_CONFIGURED');
  });

  for (const [label, value] of [
    ['règle manquante', { PAYMENT_VELOCITY: THRESHOLDS.PAYMENT_VELOCITY, REPEATED_CANCELLATIONS: THRESHOLDS.REPEATED_CANCELLATIONS }],
    ['règle inconnue', { ...THRESHOLDS, MULTI_ACCOUNT: { maxCount: 1, windowMinutes: 1 } }],
    ['champ en trop', { ...THRESHOLDS, PAYMENT_VELOCITY: { maxCount: 3, windowMinutes: 60, score: 0.5 } }],
    ['flottant', { ...THRESHOLDS, PAYMENT_VELOCITY: { maxCount: 3.5, windowMinutes: 60 } }],
    ['zéro', { ...THRESHOLDS, PAYMENT_VELOCITY: { maxCount: 0, windowMinutes: 60 } }],
    ['fenêtre au-delà d’un an', { ...THRESHOLDS, HANDOVER_SPIKE: { maxCount: 2, windowMinutes: 366 * 24 * 60 } }],
    ['texte', { ...THRESHOLDS, HANDOVER_SPIKE: { maxCount: '20', windowMinutes: 60 } }],
    ['tableau', []],
  ] as const) {
    it(`refuse un paramètre invalide : ${label} (RISK_SETTINGS_NOT_CONFIGURED)`, () => {
      refuses(() => parseRiskThresholds(value), 'RISK_SETTINGS_NOT_CONFIGURED');
    });
  }
});

describe('SEC-FRD-001 règles explicables à fenêtre glissante', () => {
  it('liste fermée des règles évaluables sur données internes', () => {
    expect(RISK_RULES).toEqual(['PAYMENT_VELOCITY', 'REPEATED_CANCELLATIONS', 'HANDOVER_SPIKE']);
  });

  it('au seuil : pas d’alerte ; au-delà : alerte avec ses preuves', () => {
    const atLimit = evaluateRule({ rule: 'PAYMENT_VELOCITY', thresholds: THRESHOLDS, events: events([1, 10, 20]), now: NOW });
    expect(atLimit).toBeNull();
    const breach = evaluateRule({ rule: 'PAYMENT_VELOCITY', thresholds: THRESHOLDS, events: events([1, 10, 20, 30]), now: NOW });
    expect(breach).toEqual({
      rule: 'PAYMENT_VELOCITY',
      evidence: {
        count: 4,
        maxCount: 3,
        windowMinutes: 60,
        windowStart: new Date(NOW - 60 * MINUTE).toISOString(),
        windowEnd: new Date(NOW).toISOString(),
        eventIds: events([1, 10, 20, 30]).map((event) => event.id).sort(),
      },
    });
  });

  it('borne de fenêtre ]now − fenêtre, now] : un événement à exactement 60 min n’est pas compté, un événement futur non plus', () => {
    expect(evaluateRule({ rule: 'PAYMENT_VELOCITY', thresholds: THRESHOLDS, events: events([1, 2, 3, 60]), now: NOW })).toBeNull();
    expect(evaluateRule({ rule: 'PAYMENT_VELOCITY', thresholds: THRESHOLDS, events: events([1, 2, 3, -1]), now: NOW })).toBeNull();
    expect(evaluateRule({ rule: 'PAYMENT_VELOCITY', thresholds: THRESHOLDS, events: events([0, 1, 2, 59]), now: NOW })).not.toBeNull();
  });

  it('chaque règle utilise son propre seuil', () => {
    const three = events([1, 2, 3]);
    expect(evaluateRule({ rule: 'REPEATED_CANCELLATIONS', thresholds: THRESHOLDS, events: three, now: NOW })?.evidence.maxCount).toBe(2);
    expect(evaluateRule({ rule: 'HANDOVER_SPIKE', thresholds: THRESHOLDS, events: three, now: NOW })).toBeNull();
  });

  it('refuse des événements invalides ou dupliqués (RISK_INVALID_REQUEST)', () => {
    refuses(() => evaluateRule({ rule: 'PAYMENT_VELOCITY', thresholds: THRESHOLDS, events: [{ id: 'x', at: NOW }], now: NOW }), 'RISK_INVALID_REQUEST');
    const [first] = events([1]);
    refuses(
      () => evaluateRule({ rule: 'PAYMENT_VELOCITY', thresholds: THRESHOLDS, events: [first!, first!], now: NOW }),
      'RISK_INVALID_REQUEST',
    );
    refuses(
      () => evaluateRule({ rule: 'PAYMENT_VELOCITY', thresholds: THRESHOLDS, events: [{ id: first!.id, at: Number.NaN }], now: NOW }),
      'RISK_INVALID_REQUEST',
    );
    refuses(() => evaluateRule({ rule: 'UNKNOWN' as 'PAYMENT_VELOCITY', thresholds: THRESHOLDS, events: [], now: NOW }), 'RISK_INVALID_REQUEST');
  });

  it('propriété : alerte ⇔ nombre d’événements dans ]now − fenêtre, now] > seuil ; preuves = ces événements exactement', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: -120, max: 240 }), { maxLength: 12 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 180 }),
        (offsets, maxCount, windowMinutes) => {
          const thresholds: RiskThresholds = { ...THRESHOLDS, PAYMENT_VELOCITY: { maxCount, windowMinutes } };
          const list = events(offsets);
          const inside = list.filter((event) => event.at > NOW - windowMinutes * MINUTE && event.at <= NOW);
          const result = evaluateRule({ rule: 'PAYMENT_VELOCITY', thresholds, events: list, now: NOW });
          if (inside.length > maxCount) {
            expect(result?.evidence.count).toBe(inside.length);
            expect(result?.evidence.eventIds).toEqual(inside.map((event) => event.id).sort());
          } else {
            expect(result).toBeNull();
          }
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('propriété : l’ordre des événements ne change pas le résultat', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 90 }), { minLength: 1, maxLength: 10 }), (offsets) => {
        const list = events(offsets);
        const a = evaluateRule({ rule: 'PAYMENT_VELOCITY', thresholds: THRESHOLDS, events: list, now: NOW });
        const b = evaluateRule({ rule: 'PAYMENT_VELOCITY', thresholds: THRESHOLDS, events: [...list].reverse(), now: NOW });
        expect(b).toEqual(a);
      }),
      { numRuns: 500 },
    );
  });
});

import { BusinessError } from '@achat/contracts';

/**
 * SEC-FRD-001 : règles explicables (aucun score opaque). Chacune compte des
 * faits internes d'un même sujet dans une fenêtre glissante ]now − fenêtre, now]
 * et alerte au-delà d'un seuil publié (paramètre versionné, fermé par défaut).
 * - PAYMENT_VELOCITY : versements confirmés d'un client ;
 * - REPEATED_CANCELLATIONS : annulations d'objectifs par un client ;
 * - HANDOVER_SPIKE : remises enregistrées par une boutique.
 * « Plusieurs comptes par appareil » et « changement de numéro suivi de
 * retrait » attendent des données non encore disponibles (attestation
 * d'appareil, lot 19 ; historique des numéros).
 */
export const RISK_RULES = ['PAYMENT_VELOCITY', 'REPEATED_CANCELLATIONS', 'HANDOVER_SPIKE'] as const;
export type RiskRule = (typeof RISK_RULES)[number];

export type RuleThreshold = { readonly maxCount: number; readonly windowMinutes: number };
export type RiskThresholds = Readonly<Record<RiskRule, RuleThreshold>>;
export type RiskEvent = { readonly id: string; readonly at: number };

export type RiskFinding = {
  readonly rule: RiskRule;
  readonly evidence: {
    readonly count: number;
    readonly maxCount: number;
    readonly windowMinutes: number;
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly eventIds: readonly string[];
  };
};

const MAX_COUNT = 10_000;
const MAX_WINDOW_MINUTES = 365 * 24 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function notConfigured(message: string): never {
  throw new BusinessError('RISK_SETTINGS_NOT_CONFIGURED', message);
}

function invalid(message: string): never {
  throw new BusinessError('RISK_INVALID_REQUEST', message);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedInteger(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max;
}

/** Valeur publiée de `risk_rule_thresholds` : exactement les trois règles, entiers bornés. */
export function parseRiskThresholds(value: unknown): RiskThresholds {
  if (!plainObject(value)) {
    notConfigured('seuils de fraude non publiés');
  }
  const keys = Object.keys(value);
  if (keys.length !== RISK_RULES.length || !RISK_RULES.every((rule) => keys.includes(rule))) {
    notConfigured('seuils attendus pour exactement les règles connues');
  }
  const parsed: Partial<Record<RiskRule, RuleThreshold>> = {};
  for (const rule of RISK_RULES) {
    const entry = value[rule];
    if (!plainObject(entry) || Object.keys(entry).length !== 2) {
      notConfigured(`seuil ${rule} invalide`);
    }
    const { maxCount, windowMinutes } = entry;
    if (!boundedInteger(maxCount, MAX_COUNT) || !boundedInteger(windowMinutes, MAX_WINDOW_MINUTES)) {
      notConfigured(`seuil ${rule} hors bornes`);
    }
    parsed[rule] = Object.freeze({ maxCount, windowMinutes });
  }
  return Object.freeze(parsed as Record<RiskRule, RuleThreshold>);
}

/** Évalue une règle sur les faits d'un sujet ; null si le seuil n'est pas dépassé. */
export function evaluateRule(input: {
  readonly rule: RiskRule;
  readonly thresholds: RiskThresholds;
  readonly events: readonly RiskEvent[];
  readonly now: number;
}): RiskFinding | null {
  if (!(RISK_RULES as readonly string[]).includes(input.rule)) {
    invalid('règle inconnue');
  }
  if (!Number.isSafeInteger(input.now)) {
    invalid('instant d’évaluation invalide');
  }
  const seen = new Set<string>();
  for (const event of input.events) {
    if (!UUID.test(event.id) || !Number.isSafeInteger(event.at) || seen.has(event.id)) {
      invalid('fait invalide ou dupliqué');
    }
    seen.add(event.id);
  }
  const { maxCount, windowMinutes } = input.thresholds[input.rule];
  const start = input.now - windowMinutes * 60_000;
  const inside = input.events.filter((event) => event.at > start && event.at <= input.now);
  if (inside.length <= maxCount) {
    return null;
  }
  return Object.freeze({
    rule: input.rule,
    evidence: Object.freeze({
      count: inside.length,
      maxCount,
      windowMinutes,
      windowStart: new Date(start).toISOString(),
      windowEnd: new Date(input.now).toISOString(),
      eventIds: Object.freeze(inside.map((event) => event.id).sort()),
    }),
  });
}

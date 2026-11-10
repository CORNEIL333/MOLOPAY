import { BusinessError } from '@achat/contracts';
import { splitEvenly, xaf } from '@achat/money';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Plan approuvé (registre D26), réduit à ce qu'exige le devis. */
export type QuotePlan = {
  readonly planId: string;
  readonly model: 'SAVE_THEN_BUY' | 'PLANNED_EXPENSE';
  readonly rhythm: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'FREE';
  readonly minAmountXaf: bigint;
  readonly maxDurationMonths: number;
};

export type QuoteResult = {
  readonly totalXaf: bigint;
  readonly feesXaf: bigint;
  readonly installments: readonly { readonly dueDate: string; readonly amountXaf: bigint }[];
};

function invalid(message: string): never {
  throw new BusinessError('CATALOG_INVALID_REQUEST', message);
}

function parseDate(value: string): number {
  if (!DATE_PATTERN.test(value)) {
    invalid('date AAAA-MM-JJ attendue');
  }
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const time = Date.UTC(y, m - 1, d);
  if (new Date(time).toISOString().slice(0, 10) !== value) {
    invalid('date inexistante');
  }
  return time;
}

function format(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** Ajoute des mois calendaires ; le jour est ramené au dernier jour du mois si besoin. */
function addMonths(time: number, months: number): number {
  const date = new Date(time);
  const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
  const lastDay = new Date(Date.UTC(new Date(target).getUTCFullYear(), new Date(target).getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(new Date(target).getUTCFullYear(), new Date(target).getUTCMonth(), Math.min(date.getUTCDate(), lastDay));
}

function dueDates(rhythm: QuotePlan['rhythm'], start: number, months: number): number[] {
  const end = addMonths(start, months);
  if (rhythm === 'FREE') {
    return [end];
  }
  if (rhythm === 'MONTHLY') {
    return Array.from({ length: months }, (_, index) => addMonths(start, index + 1));
  }
  const step = rhythm === 'WEEKLY' ? 7 * DAY_MS : DAY_MS;
  const dates: number[] = [];
  for (let time = start + step; time <= end; time += step) {
    dates.push(time);
  }
  return dates;
}

/**
 * F-CAT-004 : coût total et échéancier simulés avant engagement, pour les
 * modèles A et C (sans frais ni TEG). Répartition exclusivement par
 * `splitEvenly` (packages/money) : la somme des échéances égale le total,
 * les francs restants vont aux premières échéances. Aucune échéance ne peut
 * être inférieure au minimum du plan. Fonction pure ; la date de départ est
 * fournie par le serveur (jour courant à Douala).
 */
export function computeQuote(input: {
  readonly plan: QuotePlan;
  readonly totalXaf: bigint;
  readonly durationMonths: number;
  readonly startDate: string;
}): QuoteResult {
  const { plan } = input;
  if (!Number.isSafeInteger(input.durationMonths) || input.durationMonths < 1) {
    invalid('durée en mois entière et positive attendue');
  }
  if (input.durationMonths > plan.maxDurationMonths) {
    throw new BusinessError('CATALOG_PLAN_NOT_APPROVED', `durée au-delà du plan (${plan.maxDurationMonths} mois)`);
  }
  const total = xaf(input.totalXaf);
  if (total.amount <= 0n) {
    throw new BusinessError('INVALID_AMOUNT', 'total strictement positif attendu');
  }
  const dates = dueDates(plan.rhythm, parseDate(input.startDate), input.durationMonths);
  const amounts = splitEvenly(total, dates.length);
  const smallest = amounts[amounts.length - 1]?.amount ?? 0n;
  if (smallest < plan.minAmountXaf) {
    throw new BusinessError(
      'CATALOG_QUOTE_BELOW_MINIMUM',
      `échéance de ${smallest} FCFA sous le minimum du plan (${plan.minAmountXaf} FCFA)`,
    );
  }
  return {
    totalXaf: total.amount,
    feesXaf: 0n,
    installments: dates.map((date, index) => ({ dueDate: format(date), amountXaf: amounts[index]?.amount ?? 0n })),
  };
}

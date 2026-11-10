import { BusinessError } from '@achat/contracts';
import { xaf } from '@achat/money';

/** Clé du paramètre versionné lu par la base (migration 0036). */
export const KYC_LIMITS_SETTING_KEY = 'kyc_limits';

export type KycLimitLevel = 'BASIC' | 'STRONG';

export type KycLimits = Readonly<
  Record<KycLimitLevel, { readonly holdingXaf: bigint; readonly monthlyXaf: bigint }>
>;

/**
 * Valeurs de départ décidées le 10 novembre 2026 (D43, délégation du
 * fondateur), à faire confirmer par l'établissement de cantonnement.
 * Ce n'est qu'une proposition pour le préparateur : la base n'applique que
 * la valeur publiée après approbation maker-checker (FINANCIAL_SETTING).
 */
export const D43_KYC_LIMITS: KycLimits = {
  BASIC: { holdingXaf: 200_000n, monthlyXaf: 500_000n },
  STRONG: { holdingXaf: 2_000_000n, monthlyXaf: 2_000_000n },
};

function positive(value: bigint, field: string): string {
  const amount = xaf(value).amount;
  if (amount <= 0n) {
    throw new BusinessError('INVALID_AMOUNT', `${field} doit être strictement positif`);
  }
  return amount.toString();
}

/**
 * Valeur JSON du paramètre « kyc_limits ». Montants en texte décimal ;
 * un niveau supérieur ne peut pas avoir de plafond inférieur.
 */
export function kycLimitsSettingValue(limits: KycLimits): {
  readonly levels: Record<KycLimitLevel, { holding_xaf: string; monthly_xaf: string }>;
} {
  if (
    limits.STRONG.holdingXaf < limits.BASIC.holdingXaf ||
    limits.STRONG.monthlyXaf < limits.BASIC.monthlyXaf
  ) {
    throw new BusinessError('PAYMENT_INVALID_REQUEST', 'plafonds STRONG inférieurs à BASIC');
  }
  return {
    levels: {
      BASIC: {
        holding_xaf: positive(limits.BASIC.holdingXaf, 'BASIC.holding'),
        monthly_xaf: positive(limits.BASIC.monthlyXaf, 'BASIC.monthly'),
      },
      STRONG: {
        holding_xaf: positive(limits.STRONG.holdingXaf, 'STRONG.holding'),
        monthly_xaf: positive(limits.STRONG.monthlyXaf, 'STRONG.monthly'),
      },
    },
  };
}

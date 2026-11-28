'use client';

import type { components } from '@achat/contracts/api';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { getDictionary, type Locale } from '../i18n';
import { browserBeneficiaryPorts } from '../lib/beneficiary-ports';
import { BeneficiaryActions } from './beneficiary-actions';

/** Câblage navigateur de `BeneficiaryActions` (routes réelles, aucune simulation). */
export function BeneficiaryPanel({
  goal,
  receipt,
  locale,
}: {
  readonly goal: components['schemas']['Goal'];
  readonly receipt: components['schemas']['BeneficiaryReceipt'] | null;
  readonly locale: Locale;
}): ReactElement | null {
  const errorTitle = getDictionary(locale).goals.beneficiary.error;
  const ports = useMemo(() => browserBeneficiaryPorts(goal.goalId, errorTitle), [goal.goalId, errorTitle]);
  return <BeneficiaryActions goal={goal} receipt={receipt} locale={locale} ports={ports} />;
}

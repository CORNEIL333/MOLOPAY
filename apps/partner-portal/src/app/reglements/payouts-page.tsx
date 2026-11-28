'use client';

import type { ReactElement } from 'react';
import type { Locale } from '../../i18n';
import { PayoutsBoard } from '../../components/partner-boards';
import { browserBoardPorts } from '../../lib/ports';

export function PayoutsPage({ locale }: { readonly locale: Locale }): ReactElement {
  return <PayoutsBoard locale={locale} ports={browserBoardPorts} />;
}

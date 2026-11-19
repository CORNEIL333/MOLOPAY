'use client';

import type { ReactElement } from 'react';
import type { Locale } from '../../i18n';
import { CounterHandover } from '../../components/counter-handover';
import { browserCounterPorts } from '../../lib/ports';

export function CounterPage({ locale }: { readonly locale: Locale }): ReactElement {
  return <CounterHandover locale={locale} ports={browserCounterPorts} />;
}

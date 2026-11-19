'use client';

import type { ReactElement } from 'react';
import type { Locale } from '../../i18n';
import { OffersBoard } from '../../components/offers-board';
import { browserOffersPorts } from '../../lib/ports';

export function OffersPage({ locale }: { readonly locale: Locale }): ReactElement {
  return <OffersBoard locale={locale} ports={browserOffersPorts} />;
}

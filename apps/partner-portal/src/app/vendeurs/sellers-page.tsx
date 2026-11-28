'use client';

import type { ReactElement } from 'react';
import type { Locale } from '../../i18n';
import { SellersPanel } from '../../components/sellers-panel';
import { browserSellersPorts } from '../../lib/ports';

export function SellersPage({ locale }: { readonly locale: Locale }): ReactElement {
  return <SellersPanel locale={locale} ports={browserSellersPorts} />;
}

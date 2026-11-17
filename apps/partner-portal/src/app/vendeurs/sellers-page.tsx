'use client';

import type { ReactElement } from 'react';
import { SellersPanel } from '../../components/sellers-panel';
import { browserSellersPorts } from '../../lib/ports';

export function SellersPage(): ReactElement {
  return <SellersPanel ports={browserSellersPorts} />;
}

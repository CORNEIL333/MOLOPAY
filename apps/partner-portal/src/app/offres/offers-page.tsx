'use client';

import type { ReactElement } from 'react';
import { OffersBoard } from '../../components/offers-board';
import { browserOffersPorts } from '../../lib/ports';

export function OffersPage(): ReactElement {
  return <OffersBoard ports={browserOffersPorts} />;
}

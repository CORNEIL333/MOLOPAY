'use client';

import type { ReactElement } from 'react';
import { ProductKpisBoard } from '../../components/product-kpis-board';
import { browserProductKpisPorts } from '../../lib/ports';

export function IndicatorsPage(): ReactElement {
  return <ProductKpisBoard ports={browserProductKpisPorts} />;
}

'use client';

import type { ReactElement } from 'react';
import { SanctionsPanel } from '../../components/sanctions-panel';
import { browserSanctionsPorts } from '../../lib/ports';

export function CompliancePage(): ReactElement {
  return <SanctionsPanel ports={browserSanctionsPorts} />;
}

'use client';

import type { ReactElement } from 'react';
import { DeceaseCasesPanel } from '../../../components/decease-cases';
import { browserDeceaseCasePorts } from '../../../lib/ports';

export function DeceasePage(): ReactElement {
  return <DeceaseCasesPanel ports={browserDeceaseCasePorts} />;
}

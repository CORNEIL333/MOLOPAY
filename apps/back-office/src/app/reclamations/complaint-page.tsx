'use client';

import type { ReactElement } from 'react';
import { ComplaintDetail } from '../../components/complaint-detail';
import { browserComplaintPorts } from '../../lib/ports';

export function ComplaintPage(): ReactElement {
  return <ComplaintDetail ports={browserComplaintPorts} />;
}

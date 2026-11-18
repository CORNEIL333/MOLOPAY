'use client';

import type { ReactElement } from 'react';
import { ComplaintDetail } from '../../components/complaint-detail';
import { browserComplaintPorts } from '../../lib/ports';

export function ComplaintPage({ initialComplaintId }: { readonly initialComplaintId: string }): ReactElement {
  return <ComplaintDetail ports={browserComplaintPorts} initialComplaintId={initialComplaintId} />;
}

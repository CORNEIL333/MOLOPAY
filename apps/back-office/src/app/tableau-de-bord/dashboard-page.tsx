'use client';

import type { ReactElement } from 'react';
import { DashboardBoard } from '../../components/dashboard-board';
import { browserDashboardPorts } from '../../lib/ports';

export function DashboardPage(): ReactElement {
  return <DashboardBoard ports={browserDashboardPorts} />;
}

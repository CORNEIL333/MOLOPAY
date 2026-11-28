'use client';

import type { ReactElement } from 'react';
import { ManagerDashboard } from '../../components/manager-dashboard';
import type { Locale } from '../../i18n';
import { browserManagerDashboardPorts } from '../../lib/ports';

export function DashboardPage({ locale }: { readonly locale: Locale }): ReactElement {
  return <ManagerDashboard ports={browserManagerDashboardPorts} locale={locale} />;
}

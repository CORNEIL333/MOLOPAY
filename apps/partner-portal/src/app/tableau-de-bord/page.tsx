import type { ReactElement } from 'react';
import { currentLocale } from '../../lib/locale';
import { DashboardPage } from './dashboard-page';

export default async function Page(): Promise<ReactElement> {
  return <DashboardPage locale={await currentLocale()} />;
}

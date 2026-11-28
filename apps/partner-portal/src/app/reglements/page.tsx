import type { ReactElement } from 'react';
import { currentLocale } from '../../lib/locale';
import { PayoutsPage } from './payouts-page';

export default async function Reglements(): Promise<ReactElement> {
  return <PayoutsPage locale={await currentLocale()} />;
}

import type { ReactElement } from 'react';
import { currentLocale } from '../../lib/locale';
import { OrdersPage } from './orders-page';

export default async function Commandes(): Promise<ReactElement> {
  return <OrdersPage locale={await currentLocale()} />;
}

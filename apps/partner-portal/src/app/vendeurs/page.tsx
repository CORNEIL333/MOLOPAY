import type { ReactElement } from 'react';
import { currentLocale } from '../../lib/locale';
import { SellersPage } from './sellers-page';

export default async function Vendeurs(): Promise<ReactElement> {
  return <SellersPage locale={await currentLocale()} />;
}

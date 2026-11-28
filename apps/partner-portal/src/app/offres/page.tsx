import type { ReactElement } from 'react';
import { currentLocale } from '../../lib/locale';
import { OffersPage } from './offers-page';

export default async function Offres(): Promise<ReactElement> {
  return <OffersPage locale={await currentLocale()} />;
}

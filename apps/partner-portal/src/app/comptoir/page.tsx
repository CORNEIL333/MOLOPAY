import type { ReactElement } from 'react';
import { currentLocale } from '../../lib/locale';
import { CounterPage } from './counter-page';

export default async function Comptoir(): Promise<ReactElement> {
  return <CounterPage locale={await currentLocale()} />;
}

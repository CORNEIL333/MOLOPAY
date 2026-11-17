import type { ReactElement } from 'react';
import { currentLocale } from '../../../lib/locale';
import { LegalNamePage } from './legal-name-page';

export default async function Identite(): Promise<ReactElement> {
  return <LegalNamePage locale={await currentLocale()} />;
}

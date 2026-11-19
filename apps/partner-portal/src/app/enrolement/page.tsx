import type { ReactElement } from 'react';
import { currentLocale } from '../../lib/locale';
import { EnrollmentPage } from './enrollment-page';

export default async function Enrolement(): Promise<ReactElement> {
  return <EnrollmentPage locale={await currentLocale()} />;
}

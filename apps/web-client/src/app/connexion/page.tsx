import type { ReactElement } from 'react';
import { BrowserLogin } from '../../components/browser-device-auth';
import { currentLocale } from '../../lib/locale';

export default async function LoginPage(): Promise<ReactElement> {
  const locale = await currentLocale();
  return <BrowserLogin locale={locale} />;
}

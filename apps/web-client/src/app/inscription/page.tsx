import type { ReactElement } from 'react';
import { BrowserSignup } from '../../components/browser-device-auth';
import { currentLocale } from '../../lib/locale';

export default async function SignupPage(): Promise<ReactElement> {
  const locale = await currentLocale();
  return <BrowserSignup locale={locale} />;
}

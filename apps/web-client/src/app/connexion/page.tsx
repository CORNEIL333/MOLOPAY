import type { ReactElement } from 'react';
import { PinLoginForm } from '../../components/pin-login-form';
import { getDictionary } from '../../i18n';
import { currentLocale } from '../../lib/locale';

export default async function LoginPage(): Promise<ReactElement> {
  const locale = await currentLocale();
  return <PinLoginForm labels={getDictionary(locale).auth} />;
}

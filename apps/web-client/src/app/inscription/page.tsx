import type { ReactElement } from 'react';
import { DeviceSignupForm } from '../../components/device-auth-forms';
import { currentLocale } from '../../lib/locale';

export default async function SignupPage(): Promise<ReactElement> {
  const locale = await currentLocale();
  return <DeviceSignupForm locale={locale} />;
}

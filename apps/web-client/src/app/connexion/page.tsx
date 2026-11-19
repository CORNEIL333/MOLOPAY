import type { ReactElement } from 'react';
import { DeviceLoginForm } from '../../components/device-auth-forms';
import { currentLocale } from '../../lib/locale';

export default async function LoginPage(): Promise<ReactElement> {
  const locale = await currentLocale();
  return <DeviceLoginForm locale={locale} />;
}

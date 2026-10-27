import type { ReactElement } from 'react';
import { PhoneOtpForm } from '../../components/phone-otp-form';
import { getDictionary } from '../../i18n';
import { currentLocale } from '../../lib/locale';

export default async function SignupPage(): Promise<ReactElement> {
  const locale = await currentLocale();
  const labels = getDictionary(locale);
  return <PhoneOtpForm labels={labels.auth} locale={locale} />;
}

'use client';

import type { ReactElement } from 'react';
import type { Locale } from '../../i18n';
import { PartnerEnrollment } from '../../components/partner-enrollment';
import { browserPartnerEnrollmentPorts } from '../../lib/ports';

export function EnrollmentPage({ locale }: { readonly locale: Locale }): ReactElement {
  return <PartnerEnrollment locale={locale} ports={browserPartnerEnrollmentPorts} />;
}

'use client';

import type { ReactElement } from 'react';
import { PartnerEnrollment } from '../../components/partner-enrollment';
import { browserPartnerEnrollmentPorts } from '../../lib/ports';

export function EnrollmentPage(): ReactElement {
  return <PartnerEnrollment ports={browserPartnerEnrollmentPorts} />;
}

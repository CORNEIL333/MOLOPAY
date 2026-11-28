'use client';

import type { ReactElement } from 'react';
import { AgencyEnrollment } from '../../../components/agency-enrollment';
import { browserAgencyEnrollmentPorts } from '../../../lib/ports';

export function AgencyEnrollmentPage(): ReactElement {
  return <AgencyEnrollment ports={browserAgencyEnrollmentPorts} />;
}

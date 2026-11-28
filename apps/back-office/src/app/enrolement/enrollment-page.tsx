'use client';

import type { ReactElement } from 'react';
import { StaffEnrollment } from '../../components/staff-enrollment';
import { browserStaffEnrollmentPorts } from '../../lib/ports';

export function EnrollmentPage(): ReactElement {
  return <StaffEnrollment ports={browserStaffEnrollmentPorts} />;
}

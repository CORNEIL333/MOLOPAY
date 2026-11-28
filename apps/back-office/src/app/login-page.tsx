'use client';

import type { ReactElement } from 'react';
import { StaffLogin } from '../components/staff-login';
import { browserStaffLoginPorts } from '../lib/ports';

export function LoginPage(): ReactElement {
  return <StaffLogin ports={browserStaffLoginPorts} onSignedIn={() => { window.location.assign('/file'); }} />;
}

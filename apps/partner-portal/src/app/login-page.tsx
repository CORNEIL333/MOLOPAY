'use client';

import type { ReactElement } from 'react';
import { PartnerLogin } from '../components/partner-login';
import { browserPartnerLoginPorts } from '../lib/ports';

export function LoginPage(): ReactElement {
  return <PartnerLogin ports={browserPartnerLoginPorts} onSignedIn={() => { window.location.assign('/comptoir'); }} />;
}

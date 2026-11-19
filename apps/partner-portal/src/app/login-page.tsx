'use client';

import type { ReactElement } from 'react';
import type { Locale } from '../i18n';
import { PartnerLogin } from '../components/partner-login';
import { browserPartnerLoginPorts } from '../lib/ports';

export function LoginPage({ locale }: { readonly locale: Locale }): ReactElement {
  return <PartnerLogin locale={locale} ports={browserPartnerLoginPorts} onSignedIn={(role) => { window.location.assign(role === 'MANAGER' ? '/commandes' : '/comptoir'); }} />;
}

'use client';

import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';
import { BackofficeNav } from '../components/backoffice-nav';
import { browserStaffSignOut } from '../lib/ports';

export function SessionNav(): ReactElement | null {
  const pathname = usePathname();
  return <BackofficeNav pathname={pathname} signOut={browserStaffSignOut} onSignedOut={() => { window.location.assign('/'); }} />;
}

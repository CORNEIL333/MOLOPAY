'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { PortalNav } from '../components/portal-nav';
import { loadPartnerRole, signOutPartner } from '../lib/ports';

/** Barre de navigation affichée seulement avec une session valide (rôle relu en base). */
export function SessionNav(): ReactElement | null {
  const [role, setRole] = useState<'MANAGER' | 'SELLER' | null>(null);
  useEffect(() => {
    void loadPartnerRole().then(setRole).catch(() => { setRole(null); });
  }, []);
  return role === null ? null : <PortalNav role={role} signOut={signOutPartner} onSignedOut={() => { window.location.assign('/'); }} />;
}

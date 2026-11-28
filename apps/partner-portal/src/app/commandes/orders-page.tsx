'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { OrdersBoard } from '../../components/partner-boards';
import type { Locale } from '../../i18n';
import { browserBoardPorts, loadPartnerRole } from '../../lib/ports';

/** Le lien d'export n'est qu'une aide d'affichage : la route d'export refuse le vendeur côté serveur. */
export function OrdersPage({ locale }: { readonly locale: Locale }): ReactElement {
  const [role, setRole] = useState<'MANAGER' | 'SELLER'>('SELLER');
  useEffect(() => {
    void loadPartnerRole().then((loaded) => { if (loaded !== null) setRole(loaded); });
  }, []);
  return <OrdersBoard ports={browserBoardPorts} role={role} locale={locale} />;
}

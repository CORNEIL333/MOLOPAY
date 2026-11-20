'use client';

import type { ReactElement } from 'react';
import { browserCrmPorts } from '../../components/crm-browser-ports';
import { CrmCustomer360 } from '../../components/crm-customer-360';

export function CrmPage({ initialAccountId }: { readonly initialAccountId: string }): ReactElement {
  return <CrmCustomer360 ports={browserCrmPorts} initialAccountId={initialAccountId} />;
}

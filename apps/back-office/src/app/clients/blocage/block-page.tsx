'use client';

import type { ReactElement } from 'react';
import { CustomerBlock } from '../../../components/customer-block';
import { browserCustomerBlockPorts } from '../../../lib/ports';

export function BlockPage(): ReactElement {
  return <CustomerBlock ports={browserCustomerBlockPorts} />;
}

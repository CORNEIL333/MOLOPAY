'use client';

import type { ReactElement } from 'react';
import { PayoutsBoard } from '../../components/partner-boards';
import { browserBoardPorts } from '../../lib/ports';

export function PayoutsPage(): ReactElement {
  return <PayoutsBoard ports={browserBoardPorts} />;
}

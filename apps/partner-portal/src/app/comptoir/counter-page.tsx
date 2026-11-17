'use client';

import type { ReactElement } from 'react';
import { CounterHandover } from '../../components/counter-handover';
import { browserCounterPorts } from '../../lib/ports';

export function CounterPage(): ReactElement {
  return <CounterHandover ports={browserCounterPorts} />;
}

'use client';

import type { ReactElement } from 'react';
import { OutgoingFreeze } from '../../../components/outgoing-freeze';
import { browserOutgoingFreezePorts } from '../../../lib/ports';

export function FreezePage(): ReactElement {
  return <OutgoingFreeze ports={browserOutgoingFreezePorts} />;
}

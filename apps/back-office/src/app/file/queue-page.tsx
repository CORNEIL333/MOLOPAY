'use client';

import type { ReactElement } from 'react';
import { WorkQueue } from '../../components/work-queue';
import { browserWorkQueuePorts } from '../../lib/ports';

export function QueuePage(): ReactElement {
  return <WorkQueue ports={browserWorkQueuePorts} />;
}

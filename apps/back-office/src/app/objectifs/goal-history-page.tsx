'use client';

import type { ReactElement } from 'react';
import { GoalHistory } from '../../components/goal-history';
import { browserGoalHistoryPorts } from '../../lib/ports';

export function GoalHistoryPage({ initialGoalId }: { readonly initialGoalId: string }): ReactElement {
  return <GoalHistory ports={browserGoalHistoryPorts} initialGoalId={initialGoalId} />;
}

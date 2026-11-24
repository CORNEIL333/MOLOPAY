import type { ReactElement } from 'react';
import { GoalHistoryPage } from './goal-history-page';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** C6 / F-SUP-003 : historique d'un objectif pour le support (lien depuis la file ou une réclamation). */
export default async function Objectifs({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactElement> {
  const value = (await searchParams)['objectif'];
  return <GoalHistoryPage initialGoalId={typeof value === 'string' && UUID.test(value) ? value : ''} />;
}

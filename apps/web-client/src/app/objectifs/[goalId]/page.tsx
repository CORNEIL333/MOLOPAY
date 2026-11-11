import type { ReactElement } from 'react';
import { ErrorState } from '@achat/ui';
import { GoalOverview } from '../../../components/goal-overview';
import { BeneficiaryPanel } from '../../../components/beneficiary-panel';
import { ContributionsView } from '../../../components/contributions-view';
import { getDictionary } from '../../../i18n';
import { currentLocale } from '../../../lib/locale';
import { serverApi } from '../../../lib/server-api';
import { problemFrom } from '../../../lib/problem';

export default async function GoalPage({ params }: { readonly params: Promise<{ goalId: string }> }): Promise<ReactElement> {
  const { goalId } = await params;
  const locale = await currentLocale();
  const labels = getDictionary(locale);
  try {
    const api = await serverApi();
    const goal = await api.GET('/v1/goals/{goalId}', { params: { path: { goalId } }, cache: 'no-store' });
    if (goal.data === undefined) return <ErrorState problem={problemFrom(goal.error, goal.response, labels.goals.errorTitle)} />;
    const contributions = await api.GET('/v1/goals/{goalId}/contributions', { params: { path: { goalId } }, cache: 'no-store' });
    // D58 : reçu seulement pour un objectif C réglé ; 404 = virement encore en cours.
    const receipt = goal.data.model === 'PLANNED_EXPENSE' && (goal.data.status === 'PAID_TO_BENEFICIARY' || goal.data.status === 'CLOSED')
      ? (await api.GET('/v1/goals/{goalId}/beneficiary-receipt', { params: { path: { goalId } }, cache: 'no-store' })).data ?? null
      : null;
    return <div className="goal-detail">
      <h1 className="page-title">{labels.goals.title}</h1>
      <GoalOverview goal={goal.data} labels={labels.goals} locale={locale} />
      <BeneficiaryPanel goal={goal.data} receipt={receipt} locale={locale} />
      {contributions.data === undefined ? <ErrorState problem={problemFrom(contributions.error, contributions.response, labels.goals.errorTitle)} /> : <ContributionsView data={contributions.data} labels={labels.goals} locale={locale} />}
    </div>;
  } catch {
    return <ErrorState problem={{ title: labels.goals.errorTitle, detail: labels.errors.network }} />;
  }
}

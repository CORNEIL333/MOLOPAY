import type { ReactElement } from 'react';
import { EmptyState, ErrorState } from '@achat/ui';
import { GoalOverview } from '../../components/goal-overview';
import { DataFreshness } from '../../components/data-freshness';
import { getDictionary } from '../../i18n';
import { currentLocale } from '../../lib/locale';
import { serverApi } from '../../lib/server-api';
import { problemFrom } from '../../lib/problem';

export default async function GoalsPage(): Promise<ReactElement> {
  const locale = await currentLocale();
  const labels = getDictionary(locale);
  try {
    const result = await (await serverApi()).GET('/v1/goals', { cache: 'no-store' });
    if (result.response.status === 401) return <><h1 className="page-title">{labels.goals.title}</h1><EmptyState title={labels.goals.signedOutTitle} description={labels.goals.signedOutDescription} /><a href="/connexion">{labels.goals.signIn}</a></>;
    if (result.data === undefined) return <ErrorState problem={problemFrom(result.error, result.response, labels.goals.errorTitle)} />;
    return <>
      <h1 className="page-title">{labels.goals.title}</h1>
      {result.data.goals.length === 0 ? <><EmptyState title={labels.goals.emptyTitle} description={labels.goals.emptyDescription} /><a href="/">{labels.nav.catalog}</a></> : <div className="offer-grid">{result.data.goals.map((goal) => <GoalOverview key={goal.goalId} goal={goal} labels={labels.goals} locale={locale} />)}</div>}
      <DataFreshness label={labels.goals.asOf} asOf={result.data.asOf} locale={locale} />
    </>;
  } catch {
    return <><h1 className="page-title">{labels.goals.title}</h1><ErrorState problem={{ title: labels.goals.errorTitle, detail: labels.errors.network }} /></>;
  }
}

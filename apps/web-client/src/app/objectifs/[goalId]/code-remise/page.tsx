import type { ReactElement } from 'react';
import { ErrorState, LiquidBackground } from '@achat/ui';
import { HandoverCodePanel } from '../../../../components/goal-mvp-screens';
import { getDictionary } from '../../../../i18n';
import { currentLocale } from '../../../../lib/locale';
import { problemFrom } from '../../../../lib/problem';
import { serverApi } from '../../../../lib/server-api';

export default async function GoalHandoverCodePage({
  params,
}: {
  readonly params: Promise<{ goalId: string }>;
}): Promise<ReactElement> {
  const { goalId } = await params;
  const locale = await currentLocale();
  const labels = getDictionary(locale);
  try {
    const api = await serverApi();
    const goalRes = await api.GET('/v1/goals/{goalId}', { params: { path: { goalId } }, cache: 'no-store' });
    if (goalRes.data === undefined) return <ErrorState problem={problemFrom(goalRes.error, goalRes.response, labels.goals.errorTitle)} />;
    const codeRes = await api.GET('/v1/goals/{goalId}/handover-code', { params: { path: { goalId } }, cache: 'no-store' });
    return <><LiquidBackground universe="aurora" frozen /><HandoverCodePanel goal={goalRes.data} handover={codeRes.data ?? null} locale={locale} /></>;
  } catch {
    return <ErrorState problem={{ title: labels.goals.errorTitle, detail: labels.errors.network }} />;
  }
}

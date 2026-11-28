import type { ReactElement } from 'react';
import { ErrorState, LiquidBackground } from '@achat/ui';
import { PayComingSoonPanel } from '../../../../components/goal-mvp-screens';
import { getDictionary } from '../../../../i18n';
import { currentLocale } from '../../../../lib/locale';
import { problemFrom } from '../../../../lib/problem';
import { serverApi } from '../../../../lib/server-api';

export default async function GoalPayComingSoonPage({
  params,
}: {
  readonly params: Promise<{ goalId: string }>;
}): Promise<ReactElement> {
  const { goalId } = await params;
  const locale = await currentLocale();
  const labels = getDictionary(locale);
  try {
    const res = await (await serverApi()).GET('/v1/goals/{goalId}', { params: { path: { goalId } }, cache: 'no-store' });
    if (res.data === undefined) return <ErrorState problem={problemFrom(res.error, res.response, labels.goals.errorTitle)} />;
    return <><LiquidBackground universe="aurora" frozen /><PayComingSoonPanel goal={res.data} locale={locale} /></>;
  } catch {
    return <ErrorState problem={{ title: labels.goals.errorTitle, detail: labels.errors.network }} />;
  }
}

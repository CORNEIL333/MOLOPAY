import type { ReactElement } from 'react';
import { ErrorState } from '@achat/ui';
import { PlannedExpenseForm } from '../../../components/planned-expense-form';
import { getDictionary } from '../../../i18n';
import { currentLocale } from '../../../lib/locale';
import { problemFrom } from '../../../lib/problem';
import { serverApi } from '../../../lib/server-api';

export default async function NewPlannedExpensePage(): Promise<ReactElement> {
  const locale = await currentLocale();
  const labels = getDictionary(locale);
  try {
    const api = await serverApi();
    const plans = await api.GET('/v1/plans', { cache: 'no-store' });
    if (plans.data === undefined) {
      return (
        <ErrorState
          problem={problemFrom(plans.error, plans.response, labels.plannedExpense.errorTitle)}
        />
      );
    }
    return <PlannedExpenseForm plans={plans.data.plans} locale={locale} />;
  } catch {
    return (
      <ErrorState
        problem={{ title: labels.plannedExpense.errorTitle, detail: labels.errors.network }}
      />
    );
  }
}

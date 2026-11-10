'use client';

import type { components } from '@achat/contracts/api';
import { AmountXaf } from '@achat/ui';
import type { ReactElement } from 'react';
import { useId } from 'react';
import type { Dictionary, Locale } from '../i18n';
import { formatDate } from '../lib/date';
import { DataFreshness } from './data-freshness';

export function GoalOverview({
  goal,
  labels,
  locale,
}: {
  readonly goal: components['schemas']['Goal'];
  readonly labels: Dictionary['goals'];
  readonly locale: Locale;
}): ReactElement {
  const progressId = useId();

  return (
    <article className="achat-goal-card">
      <h2 className="achat-goal-card__title">
        <a href={`/objectifs/${encodeURIComponent(goal.goalId)}`}>
          {goal.offerTitle ?? labels.plannedExpenseTitle}
        </a>
      </h2>
      <div className="achat-goal-card__meta">
        {goal.partnerName === null ? null : <span>{goal.partnerName}</span>}
        <span>{labels.statuses[goal.status]}</span>
      </div>
      <dl>
        <div>
          <dt className="achat-goal-card__label">{labels.target}</dt>
          <dd className="achat-goal-card__target">
            <AmountXaf amount={goal.targetXaf} />
          </dd>
        </div>
        <div>
          <dt className="achat-goal-card__label">{labels.saved}</dt>
          <dd>
            <AmountXaf amount={goal.savedXaf} />
          </dd>
        </div>
        {goal.installmentAmountXaf === undefined ? null : (
          <div>
            <dt className="achat-goal-card__label">{labels.installmentAmount}</dt>
            <dd>
              <AmountXaf amount={goal.installmentAmountXaf} />
            </dd>
          </div>
        )}
        {goal.nextDueDate === undefined ? null : (
          <div>
            <dt className="achat-goal-card__label">{labels.nextDue}</dt>
            <dd>
              <time dateTime={goal.nextDueDate}>
                {formatDate(goal.nextDueDate, locale)}
              </time>
            </dd>
          </div>
        )}
      </dl>
      <div className="achat-progress">
        <label className="achat-progress__label" htmlFor={progressId}>
          {labels.progress}
        </label>
        <progress id={progressId} max={10000} value={goal.progressBasisPoints} />
      </div>
      <DataFreshness label={labels.asOf} asOf={goal.updatedAt} locale={locale} />
    </article>
  );
}

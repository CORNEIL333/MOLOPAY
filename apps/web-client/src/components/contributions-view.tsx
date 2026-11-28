import type { components } from '@achat/contracts/api';
import { AmountXaf } from '@achat/ui';
import type { ReactElement } from 'react';
import type { Dictionary, Locale } from '../i18n';
import { formatDateTime } from '../lib/date';
import { DataFreshness } from './data-freshness';

export function ContributionsView({
  data,
  labels,
  locale,
}: {
  readonly data: components['schemas']['ContributionList'];
  readonly labels: Dictionary['goals'];
  readonly locale: Locale;
}): ReactElement {
  return (
    <section>
      <h2 className="page-title">{labels.contributionsTitle}</h2>
      {data.contributions.length === 0 ? (
        <p>{labels.contributionsEmpty}</p>
      ) : (
        <ul className="quote-result__installments">
          {data.contributions.map((contribution) => (
            <li key={contribution.contributionId}>
              <AmountXaf amount={contribution.amountXaf} />{' '}
              <span>{labels.contributionStatuses[contribution.status]}</span>
              <p>
                {labels.receipt} : {contribution.receiptNumber}
              </p>
              {contribution.confirmedAt === undefined ? null : (
                <time dateTime={contribution.confirmedAt}>
                  {formatDateTime(contribution.confirmedAt, locale)}
                </time>
              )}
            </li>
          ))}
        </ul>
      )}
      <DataFreshness label={labels.asOf} asOf={data.asOf} locale={locale} />
    </section>
  );
}

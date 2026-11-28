import type { ReactElement } from 'react';
import type { Locale } from '../i18n';
import { formatDateTime } from '../lib/date';

export function DataFreshness({
  label,
  asOf,
  locale,
}: {
  readonly label: string;
  readonly asOf: string;
  readonly locale: Locale;
}): ReactElement {
  return (
    <p className="data-freshness">
      {label}{' '}
      <time dateTime={asOf}>{formatDateTime(asOf, locale)}</time>
    </p>
  );
}

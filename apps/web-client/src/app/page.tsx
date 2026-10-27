import type { ReactElement } from 'react';
import { ErrorState } from '@achat/ui';
import { CatalogView } from '../components/catalog-view';
import type { CatalogFilters } from '../components/catalog-view';
import { DataFreshness } from '../components/data-freshness';
import { getDictionary } from '../i18n';
import { currentLocale } from '../lib/locale';
import { serverApi } from '../lib/server-api';
import { problemFrom } from '../lib/problem';

export default async function CatalogPage({ searchParams }: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const locale = await currentLocale();
  const labels = getDictionary(locale);
  const query = await searchParams;
  const filters: CatalogFilters = {
    ...(query['city'] === 'yaounde' || query['city'] === 'douala' ? { city: query['city'] } : {}),
    ...(query['universe'] === 'ESSENTIALS' || query['universe'] === 'TECHNOLOGY' || query['universe'] === 'HOUSING' || query['universe'] === 'MOBILITY' ? { universe: query['universe'] } : {}),
  };
  try {
    const result = await (await serverApi()).GET('/v1/offers', { params: { query: filters }, cache: 'no-store' });
    if (result.data === undefined) {
      return <><h1 className="page-title">{labels.catalog.title}</h1><ErrorState problem={problemFrom(result.error, result.response, labels.catalog.errorTitle)} /><a href="/">{labels.common.retry}</a></>;
    }
    return <><CatalogView offers={result.data.offers} filters={filters} labels={labels.catalog} /><DataFreshness label={labels.common.lastUpdated} asOf={result.data.asOf} locale={locale} /></>;
  } catch {
    return <><h1 className="page-title">{labels.catalog.title}</h1><ErrorState problem={{ title: labels.catalog.errorTitle, detail: labels.errors.network }} /><a href="/">{labels.common.retry}</a></>;
  }
}

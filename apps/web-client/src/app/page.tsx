import type { ReactElement } from 'react';
import { ErrorState } from '@achat/ui';
import { CatalogView } from '../components/catalog-view';
import type { CatalogFilters } from '../components/catalog-view';
import { DataFreshness } from '../components/data-freshness';
import { getDictionary } from '../i18n';
import { currentLocale } from '../lib/locale';
import { serverApi } from '../lib/server-api';
import { problemFrom } from '../lib/problem';
import { catalogFiltersFromSearch, catalogPartners } from '../lib/catalog-filters';

export default async function CatalogPage({ searchParams }: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const locale = await currentLocale();
  const labels = getDictionary(locale);
  let filters: CatalogFilters;
  try { filters = catalogFiltersFromSearch(await searchParams); }
  catch {
    return <><h1 className="page-title">{labels.catalog.title}</h1><ErrorState problem={{ title: labels.catalog.invalidFiltersTitle,
      detail: labels.catalog.invalidFilters }} /><a href="/">{labels.catalog.reset}</a></>;
  }
  const retryQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (typeof value === 'string') retryQuery.set(key, value);
  const retryHref = retryQuery.size === 0 ? '/' : `/?${retryQuery.toString()}`;
  try {
    const api = await serverApi();
    const allRequest = api.GET('/v1/offers', { cache: 'no-store' });
    const [all, result] = await Promise.all([allRequest, Object.keys(filters).length === 0 ? allRequest
      : api.GET('/v1/offers', { params: { query: filters }, cache: 'no-store' })]);
    const failure = result.data === undefined ? result : all.data === undefined ? all : undefined;
    if (failure !== undefined) {
      if (all.data !== undefined) {
        return <><CatalogView offers={[]} filters={filters} labels={labels.catalog} partners={catalogPartners(all.data.offers)}
          problem={problemFrom(failure.error, failure.response, labels.catalog.errorTitle)} /><a href={retryHref}>{labels.common.retry}</a></>;
      }
      return <><h1 className="page-title">{labels.catalog.title}</h1><ErrorState problem={problemFrom(failure.error, failure.response, labels.catalog.errorTitle)} /><a href={retryHref}>{labels.common.retry}</a></>;
    }
    if (result.data === undefined || all.data === undefined) throw new Error('CATALOG_READ_FAILED');
    return <><CatalogView offers={result.data.offers} filters={filters} labels={labels.catalog} partners={catalogPartners(all.data.offers)} /><DataFreshness label={labels.common.lastUpdated} asOf={result.data.asOf} locale={locale} /></>;
  } catch {
    return <><h1 className="page-title">{labels.catalog.title}</h1><ErrorState problem={{ title: labels.catalog.errorTitle, detail: labels.errors.network }} /><a href={retryHref}>{labels.common.retry}</a></>;
  }
}

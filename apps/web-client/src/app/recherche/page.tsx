import type { ReactElement } from 'react';
import { ErrorState, LiquidBackground } from '@achat/ui';
import { OfferSearchPanel } from '../../components/favorites-view';
import { getDictionary } from '../../i18n';
import { currentLocale } from '../../lib/locale';
import { problemFrom } from '../../lib/problem';
import { serverApi } from '../../lib/server-api';

export default async function SearchPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const locale = await currentLocale();
  const labels = getDictionary(locale);
  const params = await searchParams;
  const q = typeof params['q'] === 'string' ? params['q'] : '';
  try {
    const res = await (await serverApi()).GET('/v1/offers', { cache: 'no-store' });
    if (res.data === undefined) {
      return <ErrorState problem={problemFrom(res.error, res.response, labels.catalog.errorTitle)} />;
    }
    return (
      <>
        <LiquidBackground universe="home" />
        <h1 className="page-title">{locale === 'en' ? 'Search' : 'Recherche'}</h1>
        <OfferSearchPanel offers={res.data.offers} locale={locale} initialQuery={q} />
      </>
    );
  } catch {
    return <ErrorState problem={{ title: labels.catalog.errorTitle, detail: labels.errors.network }} />;
  }
}

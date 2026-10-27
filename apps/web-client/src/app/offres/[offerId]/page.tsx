import type { ReactElement } from 'react';
import { ErrorState } from '@achat/ui';
import { OfferDetail } from '../../../components/offer-detail';
import { QuotePanel } from '../../../components/quote-panel';
import { getDictionary } from '../../../i18n';
import { currentLocale } from '../../../lib/locale';
import { serverApi } from '../../../lib/server-api';
import { problemFrom } from '../../../lib/problem';

export default async function OfferPage({ params }: { readonly params: Promise<{ offerId: string }> }): Promise<ReactElement> {
  const { offerId } = await params;
  const locale = await currentLocale();
  const labels = getDictionary(locale);
  try {
    const result = await (await serverApi()).GET('/v1/offers/{offerId}', { params: { path: { offerId } }, cache: 'no-store' });
    if (result.data === undefined) return <ErrorState problem={problemFrom(result.error, result.response, labels.offer.errorTitle)} />;
    const offer = result.data;
    return <>
      <a href="/">{labels.offer.backToCatalog}</a>
      <OfferDetail offer={offer} labels={{ ...labels.offer, ...labels.catalog }} />
      {offer.availability.kind === 'IN_STOCK' && offer.availability.units === 0 ? <p>{labels.offer.unavailable}</p> : <QuotePanel offer={offer} labels={{ ...labels.offer, models: labels.catalog.models }} locale={locale} />}
    </>;
  } catch {
    return <ErrorState problem={{ title: labels.offer.errorTitle, detail: labels.errors.network }} />;
  }
}

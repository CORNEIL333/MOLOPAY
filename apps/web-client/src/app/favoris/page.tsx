import type { ReactElement } from 'react';
import { ErrorState, LiquidBackground } from '@achat/ui';
import { FavoritesView } from '../../components/favorites-view';
import { getDictionary } from '../../i18n';
import { currentLocale } from '../../lib/locale';
import { problemFrom } from '../../lib/problem';
import { serverApi } from '../../lib/server-api';

export default async function FavoritesPage(): Promise<ReactElement> {
  const locale = await currentLocale();
  const labels = getDictionary(locale);
  try {
    const res = await (await serverApi()).GET('/v1/offers', { cache: 'no-store' });
    if (res.data === undefined) {
      return <ErrorState problem={problemFrom(res.error, res.response, labels.catalog.errorTitle)} />;
    }
    return (
      <>
        <LiquidBackground universe="home" />
        <FavoritesView offers={res.data.offers} locale={locale} />
      </>
    );
  } catch {
    return <ErrorState problem={{ title: labels.catalog.errorTitle, detail: labels.errors.network }} />;
  }
}

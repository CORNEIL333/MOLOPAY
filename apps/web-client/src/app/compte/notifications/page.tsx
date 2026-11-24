import type { ReactElement } from 'react';
import { ErrorState } from '@achat/ui';
import { NotificationsFeed } from '../../../components/notifications-feed';
import { getDictionary } from '../../../i18n';
import { currentLocale } from '../../../lib/locale';
import { problemFrom } from '../../../lib/problem';
import { serverApi } from '../../../lib/server-api';

export default async function NotificationsPage(): Promise<ReactElement> {
  const locale = await currentLocale();
  const labels = getDictionary(locale);
  const title = locale === 'en' ? 'Notifications unavailable' : 'Notifications indisponibles';
  try {
    const result = await (await serverApi()).GET('/v1/me/notifications', {
      cache: 'no-store',
    });
    if (result.response.status === 401) {
      return (
        <>
          <h1 className="page-title">Notifications</h1>
          <p>{labels.security.signInRequired}</p>
          <a href="/connexion">{labels.security.signIn}</a>
        </>
      );
    }
    if (result.data !== undefined) {
      return <NotificationsFeed initialFeed={result.data} locale={locale} />;
    }
    return <ErrorState problem={problemFrom(result.error, result.response, title)} />;
  } catch {
    return <ErrorState problem={{ title, detail: labels.errors.network }} />;
  }
}

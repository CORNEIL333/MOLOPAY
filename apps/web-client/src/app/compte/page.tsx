import type { ReactElement } from 'react';
import { ErrorState } from '@achat/ui';
import { AccountProfileCard } from '../../components/account-profile-card';
import { AccountSecurityView } from '../../components/account-security';
import { getDictionary } from '../../i18n';
import { currentLocale } from '../../lib/locale';
import { serverApi } from '../../lib/server-api';
import { problemFrom } from '../../lib/problem';

export default async function AccountPage(): Promise<ReactElement> {
  const locale = await currentLocale();
  const labels = getDictionary(locale).security;
  try {
    const api = await serverApi();
    const [result, profile] = await Promise.all([
      api.GET('/v1/me/security', { cache: 'no-store' }),
      api.GET('/v1/me', { cache: 'no-store' }),
    ]);
    if (result.response.status === 401) {
      return (
        <>
          <h1 className="page-title">{labels.title}</h1>
          <p>{labels.signInRequired}</p>
          <a href="/connexion">{labels.signIn}</a>
        </>
      );
    }
    if (result.data !== undefined) {
      return (
        <>
          {profile.data === undefined ? null : (
            <AccountProfileCard account={profile.data} locale={locale} />
          )}
          <AccountSecurityView security={result.data} locale={locale} />
        </>
      );
    }
    return <ErrorState problem={problemFrom(result.error, result.response, labels.unavailable)} />;
  } catch {
    return <ErrorState problem={{ title: labels.unavailable, detail: labels.network }} />;
  }
}

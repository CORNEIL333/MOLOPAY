import type { ReactElement } from 'react';
import { ErrorState } from '@achat/ui';
import { DataRightsView } from '../../../components/data-rights';
import { getDictionary } from '../../../i18n';
import { currentLocale } from '../../../lib/locale';
import { serverApi } from '../../../lib/server-api';
import { problemFrom } from '../../../lib/problem';

export default async function DataRightsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactElement> {
  const locale = await currentLocale(); const labels = getDictionary(locale).dataRights;
  const query = await searchParams; const before = query['before'];
  if (Object.keys(query).some((name) => name !== 'before') || (before !== undefined && (typeof before !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(before)))) {
    return <ErrorState problem={{ title: labels.unavailable, code: 'REQUEST_INVALID' }} />;
  }
  try {
    const result = await (await serverApi()).GET('/v1/me/data-rights', { params: { query: before === undefined ? {} : { before } }, cache: 'no-store' });
    if (result.response.status === 401) return <><h1 className="page-title">{labels.title}</h1><p>{labels.signInRequired}</p><a href="/connexion">{labels.signIn}</a></>;
    if (result.data !== undefined) return <DataRightsView history={result.data} locale={locale} />;
    return <ErrorState problem={problemFrom(result.error, result.response, labels.unavailable)} />;
  } catch { return <ErrorState problem={{ title: labels.unavailable, detail: labels.network }} />; }
}

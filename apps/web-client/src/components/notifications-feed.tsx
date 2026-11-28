'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, EmptyState, ErrorState } from '@achat/ui';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { getDictionary, type Locale } from '../i18n';
import { browserApi } from '../lib/browser-api';
import { formatDateTime } from '../lib/date';
import { problemFrom } from '../lib/problem';
import { DataFreshness } from './data-freshness';

type Feed = components['schemas']['CustomerNotificationFeed'];
type NotificationItem = components['schemas']['CustomerNotification'];

type LoadMoreOutcome =
  | { readonly ok: true; readonly feed: Feed }
  | { readonly ok: false; readonly problem: ProblemSummary };

async function defaultLoadMore(
  before: string,
  fallbackTitle: string,
): Promise<LoadMoreOutcome> {
  const response = await browserApi().GET('/v1/me/notifications', {
    params: { query: { before } },
    cache: 'no-store',
  });
  if (response.data !== undefined) {
    return { ok: true, feed: response.data };
  }
  return {
    ok: false,
    problem: problemFrom(response.error, response.response, fallbackTitle),
  };
}

/**
 * C5 / F-NOT-001 (Contrat 0.37.0) : fil des notifications du client dans l'application.
 * Textes génériques sans donnée personnelle (F-NOT-002), pagination par curseur `before`.
 */
export function NotificationsFeed({
  initialFeed,
  locale,
  loadMore,
}: {
  readonly initialFeed: Feed;
  readonly locale: Locale;
  readonly loadMore?: (before: string) => Promise<LoadMoreOutcome>;
}): ReactElement {
  const isEn = locale === 'en';
  const dict = getDictionary(locale);
  const [items, setItems] = useState<readonly NotificationItem[]>(initialFeed.items);
  const [nextBefore, setNextBefore] = useState<string | null>(initialFeed.nextBefore);
  const [asOf, setAsOf] = useState<string>(initialFeed.asOf);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);

  const errorTitle = isEn ? 'Notifications unavailable' : 'Notifications indisponibles';

  async function onLoadMore(): Promise<void> {
    if (nextBefore === null || loading) return;
    setLoading(true);
    setProblem(null);
    try {
      const outcome = loadMore !== undefined
        ? await loadMore(nextBefore)
        : await defaultLoadMore(nextBefore, errorTitle);
      if (outcome.ok) {
        setItems((prev) => [...prev, ...outcome.feed.items]);
        setNextBefore(outcome.feed.nextBefore);
        setAsOf(outcome.feed.asOf);
      } else {
        setProblem(outcome.problem);
      }
    } catch {
      setProblem({ title: errorTitle, detail: dict.errors.network });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-busy={loading}>
      <h1 className="page-title">Notifications</h1>
      {problem === null ? null : <ErrorState problem={problem} />}
      {items.length === 0 ? (
        <EmptyState
          title={isEn ? 'No notifications yet' : 'Aucune notification'}
          description={
            isEn
              ? 'Your payment confirmations and goal updates will appear here.'
              : 'Vos confirmations de versement et mises à jour de projets apparaîtront ici.'
          }
        />
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.notificationId}>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
              <time dateTime={item.createdAt}>
                {formatDateTime(item.createdAt, locale)}
              </time>
            </li>
          ))}
        </ul>
      )}
      <DataFreshness label={dict.common.lastUpdated} asOf={asOf} locale={locale} />
      {nextBefore === null ? null : (
        <Button type="button" variant="secondary" disabled={loading} onClick={() => { void onLoadMore(); }}>
          {isEn ? 'Load older notifications' : 'Charger plus'}
        </Button>
      )}
    </section>
  );
}

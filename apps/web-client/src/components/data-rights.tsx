'use client';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState } from '@achat/ui';
import { getDictionary, type Locale } from '../i18n';
import { browserApi } from '../lib/browser-api';
import { formatDateTime } from '../lib/date';
import { problemFrom } from '../lib/problem';
import { DataFreshness } from './data-freshness';
type Kind = components['schemas']['DataRightKind'];
type Receipt = components['schemas']['DataRightReceipt'];
const KINDS: readonly Kind[] = ['ACCESS', 'RECTIFICATION', 'OBJECTION', 'ERASURE'];
export function DataRightsView({ history, locale }: { history: components['schemas']['DataRightHistory']; locale: Locale }): ReactElement {
  const dictionary = getDictionary(locale); const labels = dictionary.dataRights;
  const [kind, setKind] = useState<Kind>('ACCESS'); const [intent, setIntent] = useState<Kind | null>(null);
  const [completed, setCompleted] = useState<Receipt | null>(null); const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(false); const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const key = useRef<string | null>(null); const submitting = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null); const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    const offline = (): void => { setOnline(false); }; const connected = (): void => { setOnline(true); };
    setOnline(navigator.onLine); window.addEventListener('offline', offline); window.addEventListener('online', connected);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', connected); };
  }, []);
  useEffect(() => {
    if (intent !== null || completed !== null) heading.current?.focus();
    else trigger.current?.focus();
  }, [intent, completed]);
  function prepare(): void { key.current = crypto.randomUUID(); setProblem(null); setIntent(kind); }
  function cancel(): void { setIntent(null); key.current = null; setProblem(null); }
  async function confirm(): Promise<void> {
    if (intent === null || !online || submitting.current || key.current === null) return;
    submitting.current = true; setPending(true); setProblem(null);
    try {
      const result = await browserApi().POST('/v1/me/data-rights', { params: { header: { 'Idempotency-Key': key.current } }, body: { kind: intent }, cache: 'no-store' });
      if (result.response.status === 201 && result.data?.kind === intent && result.data.status === 'RECEIVED') {
        setCompleted(result.data); setIntent(null); key.current = null;
      } else setProblem(problemFrom(result.error, result.response, labels.error));
    } catch { setProblem({ title: labels.error, detail: labels.network }); }
    finally { submitting.current = false; setPending(false); }
  }
  function showReceipt(item: Receipt): ReactElement { return <>
    <strong>{labels.kinds[item.kind]}</strong><p>{labels.received}</p>
    <p>{labels.reference} : <span className="data-right-reference">{item.requestId}</span></p>
    <p>{labels.date} <time dateTime={item.receivedAt}>{formatDateTime(item.receivedAt, locale)}</time></p>
  </>; }
  if (completed !== null) return <section><h1 className="page-title" tabIndex={-1} ref={heading}>{labels.title}</h1>
    <p role="status">{labels.done}</p>{showReceipt(completed)}<a href="/compte/donnees">{labels.reload}</a></section>;
  return <section aria-busy={pending}>
    <h1 className="page-title">{labels.title}</h1><p className="page-subtitle">{labels.description}</p>
    <p>{labels.limitation}</p><p>{labels.retention}</p><a href="/compte">{labels.back}</a>
    {!online ? <p role="status">{labels.offline}</p> : null}
    <form className="data-right-form" onSubmit={(event) => { event.preventDefault(); if (intent === null && online && !pending) prepare(); }}>
      <label htmlFor="data-right-kind">{labels.type}</label>
      <select id="data-right-kind" value={kind} disabled={intent !== null || pending || !online} onChange={(event) => { const value = event.currentTarget.value; if (KINDS.includes(value as Kind)) setKind(value as Kind); }}>
        {KINDS.map((value) => <option key={value} value={value}>{labels.kinds[value]}</option>)}
      </select>
      <Button type="submit" onClick={(event) => { trigger.current = event.currentTarget; }} disabled={intent !== null || pending || !online}>{labels.prepare}</Button>
    </form>
    {intent !== null ? <section aria-labelledby="rights-confirm-title" className="security-confirmation">
      <h2 id="rights-confirm-title" ref={heading} tabIndex={-1}>{labels.confirmTitle}</h2><strong>{labels.kinds[intent]}</strong><p>{labels.confirmHelp}</p>
      {problem !== null ? <ErrorState problem={problem} /> : null}
      <div className="catalog-filters__actions"><Button disabled={pending || !online} onClick={() => { void confirm(); }}>{pending ? labels.pending : labels.confirm}</Button>
        <Button variant="secondary" disabled={pending} onClick={cancel}>{labels.cancel}</Button></div>
    </section> : null}
    <h2>{labels.history}</h2>{history.items.length === 0 ? <p>{labels.empty}</p> : <ul>{history.items.map((item) => <li key={item.requestId}>{showReceipt(item)}</li>)}</ul>}
    <DataFreshness label={dictionary.common.lastUpdated} asOf={history.asOf} locale={locale} />
    <div className="catalog-filters__actions"><a href="/compte/donnees">{labels.latest}</a>
      {history.nextBefore === null ? null : <a href={`/compte/donnees?before=${encodeURIComponent(history.nextBefore)}`}>{labels.older}</a>}</div>
  </section>;
}

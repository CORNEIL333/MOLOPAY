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

type Action = 'REVOKE_OTHERS' | 'SIGN_OUT' | 'BLOCK';
export function AccountSecurityView({ security, locale }: { security: components['schemas']['AccountSecurity']; locale: Locale }): ReactElement {
  const dictionary = getDictionary(locale);
  const labels = dictionary.security;
  const [intent, setIntent] = useState<Action | null>(null);
  const [completed, setCompleted] = useState<Action | null>(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const key = useRef<string | null>(null);
  const submitting = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    const offline = (): void => { setOnline(false); };
    const connected = (): void => { setOnline(true); };
    setOnline(navigator.onLine);
    window.addEventListener('offline', offline); window.addEventListener('online', connected);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', connected); };
  }, []);
  useEffect(() => { if (intent !== null) heading.current?.focus(); }, [intent]);
  const titles = { REVOKE_OTHERS: labels.confirmOthers, SIGN_OUT: labels.confirmSignout, BLOCK: labels.confirmBlock };
  const help = { REVOKE_OTHERS: labels.othersHelp, SIGN_OUT: labels.signoutHelp, BLOCK: labels.blockHelp };
  function choose(action: Action, button: HTMLButtonElement): void {
    trigger.current = button; key.current = crypto.randomUUID(); setProblem(null); setIntent(action);
  }
  function cancel(): void { setIntent(null); key.current = null; setProblem(null); trigger.current?.focus(); }
  async function confirm(): Promise<void> {
    if (intent === null || !online || submitting.current || key.current === null) return;
    submitting.current = true; setPending(true); setProblem(null);
    try {
      const api = browserApi();
      const params = { header: { 'Idempotency-Key': key.current } };
      const result = intent === 'BLOCK'
        ? await api.POST('/v1/me/security/block', { params, body: { reason: 'LOST_OR_STOLEN' }, cache: 'no-store' })
        : intent === 'REVOKE_OTHERS'
          ? await api.POST('/v1/me/security/revoke-other-sessions', { params, cache: 'no-store' })
          : await api.POST('/v1/auth/signouts', { params, cache: 'no-store' });
      if (intent === 'SIGN_OUT' ? result.response.status === 204
        : result.response.status === 200 && result.data !== undefined && result.data.action === intent) {
        setCompleted(intent); setIntent(null); key.current = null;
      } else { setProblem(problemFrom(result.error, result.response, labels.error)); }
    } catch { setProblem({ title: labels.error, detail: labels.network }); }
    finally { submitting.current = false; setPending(false); }
  }
  if (completed !== null) return <section>
    <h1 className="page-title">{labels.title}</h1>
    <p role="status">{completed === 'BLOCK' ? labels.blockDone : completed === 'SIGN_OUT' ? labels.signoutDone : labels.otherDone}</p>
    <a href={completed === 'REVOKE_OTHERS' ? '/compte' : '/connexion'}>{completed === 'REVOKE_OTHERS' ? labels.reload : labels.signIn}</a>
  </section>;
  return <section aria-busy={pending}>
    <h1 className="page-title">{labels.title}</h1><p className="page-subtitle">{labels.description}</p>
    <a href="/compte/donnees">{dictionary.dataRights.title}</a>
    <h2>{labels.devices}</h2>
    <ul>{security.devices.map((device) => <li key={device.deviceId}>
      <strong>{device.name}</strong>{' · '}{device.status === 'ACTIVE' ? labels.active : labels.revoked}{device.current ? ` · ${labels.current}` : ''}
      <p>{labels.registered} <time dateTime={device.registeredAt}>{formatDateTime(device.registeredAt, locale)}</time></p>
    </li>)}</ul>
    <h2>{labels.sessions}</h2>
    <ul>{security.sessions.map((session) => <li key={session.sessionId}>
      <strong>{session.deviceName}</strong>{session.current ? ` · ${labels.current}` : ''}
      <p>{labels.created} <time dateTime={session.createdAt}>{formatDateTime(session.createdAt, locale)}</time><br />
        {labels.refreshExpires} <time dateTime={session.refreshExpiresAt}>{formatDateTime(session.refreshExpiresAt, locale)}</time></p>
    </li>)}</ul>
    <DataFreshness label={dictionary.common.lastUpdated} asOf={security.asOf} locale={locale} />
    {!online ? <p role="status">{labels.offline}</p> : null}
    <div className="catalog-filters__actions">
      <Button disabled={pending || !online} onClick={(event) => { choose('REVOKE_OTHERS', event.currentTarget); }}>{labels.others}</Button>
      <Button variant="secondary" disabled={pending || !online} onClick={(event) => { choose('SIGN_OUT', event.currentTarget); }}>{labels.signout}</Button>
      <Button variant="danger" disabled={pending || !online} onClick={(event) => { choose('BLOCK', event.currentTarget); }}>{labels.block}</Button>
    </div>
    {intent !== null ? <section aria-labelledby="security-confirm-title" className="security-confirmation">
      <h2 id="security-confirm-title" tabIndex={-1} ref={heading}>{titles[intent]}</h2><p>{help[intent]}</p>
      {problem !== null ? <ErrorState problem={problem} /> : null}
      <div className="catalog-filters__actions"><Button variant={intent === 'BLOCK' ? 'danger' : 'primary'} disabled={pending || !online} onClick={() => { void confirm(); }}>{pending ? labels.pending : labels.confirm}</Button>
        <Button variant="secondary" disabled={pending} onClick={cancel}>{labels.cancel}</Button></div>
    </section> : null}
  </section>;
}

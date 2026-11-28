'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, StatusPill, TextField } from '@achat/ui';
import { useCallback, useEffect, useId, useState, type FormEvent, type ReactElement } from 'react';
import { getDictionary, type Locale } from '../i18n';

type PartnerUser = { readonly userId: string; readonly login: string; readonly role: 'MANAGER' | 'SELLER'; readonly active: boolean };
type Failure = { readonly ok: false; readonly problem: ProblemSummary };

/** Appels injectés (`browserSellersPorts`) ; le serveur vérifie le gérant et son partenaire à chaque appel. */
export type SellersPorts = {
  readonly load: () => Promise<{ readonly ok: true; readonly users: readonly PartnerUser[] } | Failure>;
  readonly create: (login: string) => Promise<{ readonly ok: true; readonly sellerId: string } | Failure>;
  readonly issueEnrollment: (sellerId: string) => Promise<{ readonly ok: true; readonly challengeId: string; readonly challenge: string; readonly enrollmentToken?: string } | Failure>;
  readonly disable: (sellerId: string, reason: string) => Promise<{ readonly ok: true } | Failure>;
};

const LOGIN = /^[a-z][a-z0-9._-]{2,63}$/;

/**
 * F-PRT-003 / D63 : le gérant crée ses vendeurs, émet leur code
 * d'enrôlement (affiché une seule fois, jamais conservé ici après remise)
 * et les désactive avec un motif.
 */
export function SellersPanel({ ports, locale = 'fr' }: { readonly ports: SellersPorts; readonly locale?: Locale }): ReactElement {
  const dictionary = getDictionary(locale);
  const t = dictionary.sellers;
  const ids = { login: useId(), reason: useId() };
  const [users, setUsers] = useState<readonly PartnerUser[] | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [login, setLogin] = useState('');
  const [loginError, setLoginError] = useState<string | undefined>(undefined);
  const [code, setCode] = useState<{ readonly login: string; readonly value: string } | null>(null);
  const [disabling, setDisabling] = useState<PartnerUser | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    const result = await ports.load();
    if (result.ok) setUsers(result.users);
    else setProblem(result.problem);
  }, [ports]);

  useEffect(() => {
    reload().catch(() => { setProblem({ title: dictionary.common.loadFailed, detail: dictionary.common.serviceDown }); });
  }, [reload, dictionary]);

  async function run(action: () => Promise<{ readonly ok: boolean; readonly problem?: ProblemSummary }>, after: () => void): Promise<void> {
    setPending(true);
    setProblem(null);
    try {
      const result = await action();
      if (result.ok) {
        after();
        await reload();
      } else if (result.problem !== undefined) {
        setProblem(result.problem);
      }
    } catch {
      setProblem({ title: dictionary.common.actionFailed, detail: dictionary.common.serviceDown });
    } finally {
      setPending(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!LOGIN.test(login)) {
      setLoginError(t.invalidLogin);
      return;
    }
    setLoginError(undefined);
    await run(() => ports.create(login), () => { setLogin(''); });
  }

  async function issue(user: PartnerUser): Promise<void> {
    setCode(null);
    await run(async () => {
      const result = await ports.issueEnrollment(user.userId);
      if (result.ok && result.enrollmentToken !== undefined) {
        setCode({ login: user.login, value: `${result.challengeId}.${result.challenge}.${result.enrollmentToken}` });
      }
      return result;
    }, () => undefined);
  }

  async function disable(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (disabling === null) return;
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setReasonError(t.reasonRequired);
      return;
    }
    setReasonError(undefined);
    await run(() => ports.disable(disabling.userId, trimmed), () => { setDisabling(null); setReason(''); });
  }

  return (
    <section className="mp-page">
      <header className="mp-top"><h1>{t.title}</h1></header>
      {problem === null ? null : <ErrorState problem={problem} />}
      {code === null ? null : (
        <div className="mp-panel" role="status">
          <p>{t.codeIntro(code.login)}</p>
          <p><code aria-label={t.codeLabel}>{code.value}</code></p>
          <Button type="button" onClick={() => { setCode(null); }}>{t.codeHanded}</Button>
        </div>
      )}
      {users === null ? null : (
        <div className="mp-panel mp-table-wrap">
          <table className="mp-table" aria-label={t.table}>
            <thead>
              <tr><th scope="col">{t.columns.login}</th><th scope="col">{t.columns.role}</th><th scope="col">{t.columns.state}</th><th scope="col">{t.columns.actions}</th></tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.userId}>
                  <td><strong>{user.login}</strong></td>
                  <td>{user.role === 'MANAGER' ? t.manager : t.seller}</td>
                  <td><StatusPill tone={user.active ? 'ok' : 'plain'}>{user.active ? t.active : t.disabled}</StatusPill></td>
                  <td>
                    {user.role === 'SELLER' && user.active ? (
                      <div className="mp-actions">
                        <Button type="button" variant="secondary" disabled={pending} aria-label={t.enrollmentLabel(user.login)} onClick={() => void issue(user)}>{t.enrollmentButton}</Button>
                        <Button type="button" variant="danger" disabled={pending} aria-label={t.disableLabel(user.login)} onClick={() => { setDisabling(user); setReason(''); setReasonError(undefined); }}>{t.disableButton}</Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {disabling === null ? null : (
        <form className="mp-panel mp-form" onSubmit={(event) => void disable(event)} noValidate>
          <h2>{t.disableTitle(disabling.login)}</h2>
          <TextField id={ids.reason} label={t.reason} value={reason} error={reasonError} onChange={(event) => { setReason(event.target.value); }} />
          <Button type="submit" variant="danger" disabled={pending}>{t.confirmDisable}</Button>
        </form>
      )}
      <form className="mp-panel mp-form" onSubmit={(event) => void create(event)} noValidate>
        <h2>{t.newTitle}</h2>
        <TextField id={ids.login} label={t.newLogin} autoComplete="off" value={login} error={loginError} onChange={(event) => { setLogin(event.target.value.trim()); }} />
        <Button type="submit" disabled={pending}>{t.create}</Button>
      </form>
    </section>
  );
}

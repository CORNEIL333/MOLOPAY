'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { useCallback, useEffect, useId, useState, type FormEvent, type ReactElement } from 'react';

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
export function SellersPanel({ ports }: { readonly ports: SellersPorts }): ReactElement {
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
    reload().catch(() => { setProblem({ title: 'Chargement impossible', detail: 'Le service ne répond pas. Réessayez.' }); });
  }, [reload]);

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
      setProblem({ title: 'Action impossible', detail: 'Le service ne répond pas. Réessayez.' });
    } finally {
      setPending(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!LOGIN.test(login)) {
      setLoginError('Identifiant invalide (minuscules, chiffres, point, tiret ; 3 caractères au moins).');
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
      setReasonError('Le motif est obligatoire.');
      return;
    }
    setReasonError(undefined);
    await run(() => ports.disable(disabling.userId, trimmed), () => { setDisabling(null); setReason(''); });
  }

  return (
    <section>
      <h1>Personnel</h1>
      {problem === null ? null : <ErrorState problem={problem} />}
      {code === null ? null : (
        <div role="status">
          <p>Code d’enrôlement de {code.login}, valable 5 minutes, à remettre en main propre. Il ne sera plus affiché.</p>
          <p><code aria-label="Code d’enrôlement à remettre en main propre">{code.value}</code></p>
          <Button type="button" onClick={() => { setCode(null); }}>J’ai remis le code</Button>
        </div>
      )}
      {users === null ? null : (
        <table aria-label="Personnel">
          <thead>
            <tr><th scope="col">Identifiant</th><th scope="col">Rôle</th><th scope="col">État</th><th scope="col">Actions</th></tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.userId}>
                <td>{user.login}</td>
                <td>{user.role === 'MANAGER' ? 'Gérant' : 'Vendeur'}</td>
                <td>{user.active ? 'Actif' : 'Désactivé'}</td>
                <td>
                  {user.role === 'SELLER' && user.active ? (
                    <>
                      <Button type="button" disabled={pending} aria-label={`Émettre un code d’enrôlement pour ${user.login}`} onClick={() => void issue(user)}>Code d’enrôlement</Button>
                      <Button type="button" disabled={pending} aria-label={`Désactiver ${user.login}`} onClick={() => { setDisabling(user); setReason(''); setReasonError(undefined); }}>Désactiver</Button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {disabling === null ? null : (
        <form onSubmit={(event) => void disable(event)} noValidate>
          <h2>Désactiver {disabling.login}</h2>
          <TextField id={ids.reason} label="Motif de la désactivation" value={reason} error={reasonError} onChange={(event) => { setReason(event.target.value); }} />
          <Button type="submit" disabled={pending}>Confirmer la désactivation</Button>
        </form>
      )}
      <form onSubmit={(event) => void create(event)} noValidate>
        <h2>Nouveau vendeur</h2>
        <TextField id={ids.login} label="Identifiant du nouveau vendeur" autoComplete="off" value={login} error={loginError} onChange={(event) => { setLogin(event.target.value.trim()); }} />
        <Button type="submit" disabled={pending}>Créer le vendeur</Button>
      </form>
    </section>
  );
}

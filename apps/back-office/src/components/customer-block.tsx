'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { useId, useRef, useState, type FormEvent, type ReactElement } from 'react';

/** Appel injecté (`browserCustomerBlockPorts`) : route réelle, droits et motif vérifiés côté serveur, audit chaîné. */
export type CustomerBlockPorts = {
  readonly block: (accountId: string, reason: string) => Promise<{ readonly ok: true; readonly blockedAt: string } | { readonly ok: false; readonly problem: ProblemSummary }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * C4 / F-ACC-006 : perte ou vol du téléphone — blocage d'un compte client
 * par le support ou le risque. Résumé et confirmation explicite avant
 * l'appel : le déblocage exige une récupération avec KYC renforcé.
 */
export function CustomerBlock({ ports }: { readonly ports: CustomerBlockPorts }): ReactElement {
  const ids = { account: useId(), reason: useId(), summary: useId() };
  const [accountId, setAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ readonly account?: string; readonly reason?: string }>({});
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [blockedAt, setBlockedAt] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);

  function prepare(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next = {
      ...(UUID.test(accountId) ? {} : { account: 'Identifiant de compte invalide.' }),
      ...(reason.trim().length >= 3 ? {} : { reason: 'Le motif est obligatoire (3 caractères au moins).' }),
    };
    setErrors(next);
    setProblem(null);
    setConfirming(Object.keys(next).length === 0);
  }

  async function confirm(): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    try {
      const result = await ports.block(accountId, reason.trim());
      if (result.ok) {
        setBlockedAt(result.blockedAt);
        setConfirming(false);
      } else {
        setProblem(result.problem);
      }
    } catch {
      setProblem({ title: 'Blocage non confirmé', detail: 'Connexion interrompue. Vérifiez l’état du compte avant de réessayer.' });
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return (
    <section>
      <h1>Bloquer un compte client</h1>
      <p>Perte ou vol du téléphone, ou fraude présumée. Le blocage est immédiat ; le déblocage exige une récupération avec vérification d’identité renforcée.</p>
      {blockedAt === null ? (
        <form onSubmit={prepare} noValidate>
          <TextField id={ids.account} label="Identifiant du compte client" autoComplete="off" value={accountId} error={errors.account} onChange={(event) => { setAccountId(event.target.value.trim()); setConfirming(false); }} />
          <TextField id={ids.reason} label="Motif du blocage" value={reason} error={errors.reason} onChange={(event) => { setReason(event.target.value); setConfirming(false); }} />
          <Button type="submit" disabled={pending}>Préparer le blocage</Button>
        </form>
      ) : null}
      {confirming && blockedAt === null ? (
        <section aria-labelledby={ids.summary}>
          <h2 id={ids.summary}>Confirmer le blocage</h2>
          <p>Compte : <strong>{accountId}</strong></p>
          <p>Motif : {reason.trim()}</p>
          <p>Le compte ne pourra plus rien faire ; tous les appareils et sessions du client sont fermés.</p>
          <Button type="button" disabled={pending} onClick={() => void confirm()}>Bloquer le compte</Button>
          <Button type="button" disabled={pending} onClick={() => { setConfirming(false); }}>Annuler</Button>
        </section>
      ) : null}
      {problem === null ? null : <ErrorState problem={problem} />}
      {blockedAt === null ? null : <p role="status">Compte bloqué le {new Date(blockedAt).toLocaleString('fr-FR', { timeZone: 'Africa/Douala' })}.</p>}
    </section>
  );
}

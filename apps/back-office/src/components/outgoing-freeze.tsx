'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { useCallback, useEffect, useId, useState, type FormEvent, type ReactElement } from 'react';

export type FreezeState = components['schemas']['OutgoingFreezeState'];
type Failure = { readonly ok: false; readonly problem: ProblemSummary };

/** Appels injectés (`browserOutgoingFreezePorts`) : routes réelles ; règles et deux personnes vérifiées par le serveur et la base. */
export type OutgoingFreezePorts = {
  readonly load: () => Promise<{ readonly ok: true; readonly state: FreezeState } | Failure>;
  readonly request: (action: 'FREEZE' | 'UNFREEZE', reason: string) => Promise<{ readonly ok: true } | Failure>;
  readonly confirm: (requestId: string) => Promise<{ readonly ok: true } | Failure>;
};

/** Cause affichée : gel demandé (motif) et/ou divergence du contrôle nocturne (INT-VER-002). */
function freezeCause(state: FreezeState): string {
  const parts: string[] = [];
  if (state.reason !== null) parts.push(`motif : ${state.reason}`);
  if (state.divergence !== null) parts.push(`divergence d’intégrité détectée par le vérificateur indépendant (${state.divergence.code})`);
  return parts.length === 0 ? 'motif : —' : parts.join(' ; ');
}

const DATE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Douala' });

/**
 * C7 / SEC-INC-003 : interrupteur d'arrêt des flux sortants. Une personne
 * demande (motif obligatoire), une autre confirme dans l'heure ; tant que le
 * gel est actif, aucune nouvelle instruction de sortie de fonds n'est émise.
 */
export function OutgoingFreeze({ ports }: { readonly ports: OutgoingFreezePorts }): ReactElement {
  const ids = { reason: useId(), pending: useId() };
  const [state, setState] = useState<FreezeState | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await ports.load();
    if (result.ok) setState(result.state);
    else setProblem(result.problem);
  }, [ports]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function run(action: () => Promise<{ readonly ok: true } | Failure>): Promise<void> {
    setPending(true);
    setProblem(null);
    try {
      const result = await action();
      if (result.ok) await refresh();
      else setProblem(result.problem);
    } catch {
      setProblem({ title: 'Action non confirmée', detail: 'Connexion interrompue. Relisez l’état avant de réessayer.' });
    } finally {
      setPending(false);
    }
  }

  function ask(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (state === null) return;
    if (reason.trim().length < 3) {
      setError('Le motif est obligatoire (3 caractères au moins).');
      return;
    }
    setError(undefined);
    void run(() => ports.request(state.frozen ? 'UNFREEZE' : 'FREEZE', reason.trim())).then(() => { setReason(''); });
  }

  return (
    <section>
      <h1>Gel des flux sortants</h1>
      <p>En cas d’incident, deux personnes peuvent suspendre toute nouvelle instruction de règlement, de remboursement ou de virement. La demande doit être confirmée par une autre personne dans l’heure.</p>
      {state === null ? null : (
        <p role="status">
          {state.frozen
            ? `Flux sortants gelés depuis le ${state.since === null ? '—' : DATE.format(new Date(state.since))} — ${freezeCause(state)}`
            : 'Flux sortants ouverts.'}
        </p>
      )}
      {problem === null ? null : <ErrorState problem={problem} />}
      {state === null || state.pending.length === 0 ? null : (
        <section aria-labelledby={ids.pending}>
          <h2 id={ids.pending}>Demandes à confirmer</h2>
          <ul>
            {state.pending.map((item) => {
              const label = `${item.action === 'FREEZE' ? 'gel' : 'levée du gel'} demandé par ${item.requestedBy}`;
              return (
                <li key={item.requestId}>
                  {`${item.action === 'FREEZE' ? 'Gel' : 'Levée'} — ${item.reason} — ${item.requestedBy}, ${DATE.format(new Date(item.requestedAt))} `}
                  <Button disabled={pending} onClick={() => void run(() => ports.confirm(item.requestId))} aria-label={`Confirmer : ${label}`}>Confirmer</Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {state === null ? null : (
        <form onSubmit={ask} noValidate>
          <TextField id={ids.reason} label="Motif" value={reason} error={error} onChange={(event) => { setReason(event.target.value); }} />
          <Button type="submit" variant={state.frozen ? 'secondary' : 'danger'} disabled={pending}>{state.frozen ? 'Demander la levée du gel' : 'Demander le gel'}</Button>
        </form>
      )}
    </section>
  );
}

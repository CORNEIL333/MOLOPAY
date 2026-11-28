'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { AmountXaf, Button, ErrorState, TextField } from '@achat/ui';
import { useId, useState, type FormEvent, type ReactElement } from 'react';

type History = components['schemas']['StaffGoalHistory'];
type Item = History['items'][number];

/** Lecture injectée (`browserGoalHistoryPorts`) : route réelle, motif inscrit à l'audit (F-BO-004). */
export type GoalHistoryPorts = {
  readonly load: (goalId: string, reason: string) => Promise<{ readonly ok: true; readonly history: History } | { readonly ok: false; readonly problem: ProblemSummary }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KINDS: Readonly<Record<string, string>> = {
  AGREEMENT_STATUS: 'Changement de statut',
  AGREEMENT_LOCK: 'Verrouillage',
  PAYMENT_ATTEMPT: 'Tentative de versement',
  PAYMENT_STATUS: 'État du versement',
  COMPLAINT: 'Réclamation reçue',
  COMPLAINT_CLOSED: 'Réclamation close',
  DISPUTE_OPENED: 'Litige ouvert',
  DISPUTE_RESOLVED: 'Litige levé',
};
const DATE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Douala' });

/** Détails d'un événement : transition, montant en FCFA entiers, autres identifiants internes. */
function details(item: Item): ReactElement {
  const parts: ReactElement[] = [];
  if (typeof item['from'] === 'string' && typeof item['to'] === 'string') parts.push(<span key="transition">{`${item['from']} → ${item['to']}`}</span>);
  if (typeof item['amountXaf'] === 'string') parts.push(<AmountXaf key="amount" amount={item['amountXaf']} />);
  for (const [key, value] of Object.entries(item)) {
    if (['at', 'kind', 'from', 'to', 'amountXaf'].includes(key) || value === null) continue;
    parts.push(<span key={key}>{`${key} : ${String(value)}`}</span>);
  }
  return <>{parts.map((part, index) => <span key={index.toString()}>{index === 0 ? null : ' · '}{part}</span>)}</>;
}

/**
 * C6 / F-SUP-003 : historique chronologique d'un objectif pour le support
 * (statuts, versements, réclamations, litiges), consultation motivée et
 * journalisée côté serveur. Aucune donnée personnelle du client.
 */
export function GoalHistory({ ports, initialGoalId = '' }: { readonly ports: GoalHistoryPorts; readonly initialGoalId?: string }): ReactElement {
  const ids = { goal: useId(), reason: useId(), list: useId() };
  const [goalId, setGoalId] = useState(initialGoalId);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ readonly goal?: string; readonly reason?: string }>({});
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [pending, setPending] = useState(false);

  async function load(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const next = {
      ...(UUID.test(goalId) ? {} : { goal: 'Identifiant invalide (UUID).' }),
      ...(reason.trim().length >= 3 ? {} : { reason: 'Indiquez le motif de la consultation (3 caractères au moins).' }),
    };
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setProblem(null);
    setHistory(null);
    setPending(true);
    try {
      const result = await ports.load(goalId, reason.trim());
      if (result.ok) setHistory(result.history);
      else setProblem(result.problem);
    } catch {
      setProblem({ title: 'Chargement impossible', detail: 'Le service ne répond pas. Réessayez.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h1>Historique d’un objectif</h1>
      <form onSubmit={(event) => void load(event)} noValidate>
        <TextField id={ids.goal} label="Identifiant de l’objectif" autoComplete="off" value={goalId} error={errors.goal} onChange={(event) => { setGoalId(event.target.value.trim()); }} />
        <TextField id={ids.reason} label="Motif de la consultation" value={reason} error={errors.reason} onChange={(event) => { setReason(event.target.value); }} />
        <Button type="submit" disabled={pending}>Consulter l’historique</Button>
      </form>
      {problem === null ? null : <ErrorState problem={problem} />}
      {history === null ? null : (
        <section aria-labelledby={ids.list}>
          <h2 id={ids.list}>Événements de l’objectif</h2>
          {history.items.length === 0 ? <p>Aucun événement.</p> : (
            <ol aria-labelledby={ids.list}>
              {history.items.map((item, index) => (
                <li key={index.toString()}>
                  {typeof item['at'] === 'string' ? <time dateTime={item['at']}>{DATE.format(new Date(item['at']))}</time> : null}
                  {' — '}<strong>{KINDS[String(item['kind'])] ?? String(item['kind'])}</strong>{' — '}{details(item)}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </section>
  );
}

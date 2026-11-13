'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { useId, useState, type FormEvent, type ReactElement } from 'react';

type Queue = components['schemas']['BackofficeQueue'];
type Item = Readonly<Record<string, unknown>>;

export type WorkQueuePorts = {
  readonly loadQueue: (reason: string) => Promise<{ readonly ok: true; readonly queue: Queue } | { readonly ok: false; readonly problem: ProblemSummary }>;
};

const STAGES: Readonly<Record<string, string>> = {
  AWAITING_DECISION: 'En attente de décision',
  AWAITING_INSTRUCTION: 'En attente d’instruction',
  AWAITING_EXECUTION: 'En attente d’exécution',
};

const SECTIONS: readonly { readonly key: keyof Omit<Queue, 'asOf'>; readonly title: string }[] = [
  { key: 'refunds', title: 'Remboursements' },
  { key: 'beneficiaryPayouts', title: 'Virements aux bénéficiaires' },
  { key: 'settlements', title: 'Règlements marchands' },
  { key: 'overdueInstructions', title: 'Instructions sans exécution après 24 h' },
  { key: 'gapsToEscalate', title: 'Écarts de cantonnement à escalader' },
  { key: 'unjustifiedSuspense', title: 'Suspens 2900 non justifié' },
  { key: 'openRiskAlerts', title: 'Alertes de fraude ouvertes' },
  { key: 'overdueComplaints', title: 'Réclamations en retard' },
];

/** Résumé lisible d'un élément : identifiants internes, montants, étape ; aucune donnée personnelle. */
function describe(item: Item): string {
  return Object.entries(item)
    .filter(([key]) => key !== 'stage')
    .map(([key, value]) => `${key} : ${String(value)}`)
    .join(' · ');
}

/** F-BO-003 / F-BO-004 : file de travail, consultation motivée (le motif est inscrit à l'audit). */
export function WorkQueue({ ports }: { readonly ports: WorkQueuePorts }): ReactElement {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [pending, setPending] = useState(false);

  async function load(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setError('Motif obligatoire (3 caractères au moins) : il est inscrit au journal d’audit.');
      return;
    }
    setError(undefined);
    setProblem(null);
    setPending(true);
    try {
      const result = await ports.loadQueue(reason.trim());
      if (result.ok) {
        setQueue(result.queue);
      } else {
        setProblem(result.problem);
      }
    } catch {
      setProblem({ title: 'Lecture impossible', detail: 'Une connexion réseau est nécessaire.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h1>File de travail</h1>
      <form onSubmit={(event) => void load(event)} noValidate>
        <TextField id={reasonId} label="Motif de consultation" value={reason} error={error} onChange={(event) => { setReason(event.target.value); }} />
        <Button type="submit" disabled={pending}>
          Afficher la file
        </Button>
      </form>
      {problem === null ? null : <ErrorState problem={problem} />}
      {queue === null
        ? null
        : SECTIONS.map(({ key, title }) => {
            const items = queue[key] as readonly Item[];
            return (
              <section key={key}>
                <h2>{`${title} (${items.length.toString()})`}</h2>
                <ul>
                  {items.map((item, index) => (
                    <li key={`${key}-${index.toString()}`}>
                      {typeof item['stage'] === 'string' ? <strong>{STAGES[item['stage']] ?? item['stage']}</strong> : null} {describe(item)}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
    </section>
  );
}

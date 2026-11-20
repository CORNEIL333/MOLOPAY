'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextArea, TextField } from '@achat/ui';
import { useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { CrmInteractionInput, CrmResult } from './crm-ports';

const CHANNELS: readonly (readonly [string, string])[] = [
  ['PHONE', 'Téléphone'],
  ['WHATSAPP', 'WhatsApp'],
  ['SMS', 'SMS'],
  ['EMAIL', 'Courriel'],
  ['WALK_IN', 'Visite au guichet'],
  ['APP', 'Application'],
  ['OTHER', 'Autre'],
];

const DIRECTIONS: readonly (readonly [string, string])[] = [
  ['INBOUND', 'Le client nous a contactés'],
  ['OUTBOUND', 'Nous avons contacté le client'],
];

/** Instant local saisi par l'agent ; l'interface envoie l'UTC. */
function localNow(): string {
  const now = new Date();
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `${now.getFullYear().toString()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * Q5 / F-SUP-001 : saisie d'un échange de support. Chaque échange s'ajoute au
 * journal du client (aucune modification possible) avec son auteur.
 */
export function CrmInteractionForm({ submit }: { readonly submit: (input: CrmInteractionInput) => Promise<CrmResult<null>> }): ReactElement {
  const ids = { section: useId(), channel: useId(), direction: useId(), summary: useId(), outcome: useId(), occurredAt: useId() };
  const [channel, setChannel] = useState('PHONE');
  const [direction, setDirection] = useState('INBOUND');
  const [summary, setSummary] = useState('');
  const [outcome, setOutcome] = useState('');
  const [occurredAt, setOccurredAt] = useState(localNow);
  const [summaryError, setSummaryError] = useState<string | undefined>(undefined);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (sending.current) return;
    setSaved(false);
    setProblem(null);
    const trimmed = summary.trim();
    const instant = new Date(occurredAt);
    setSummaryError(trimmed.length < 3 ? 'Le résumé est obligatoire (3 caractères au moins).' : undefined);
    setTimeError(Number.isNaN(instant.getTime()) ? 'Instant de l’échange invalide.' : null);
    if (trimmed.length < 3 || Number.isNaN(instant.getTime())) {
      return;
    }
    sending.current = true;
    setPending(true);
    try {
      const result = await submit({
        channel,
        direction,
        summary: trimmed,
        outcome: outcome.trim() === '' ? null : outcome.trim(),
        occurredAt: instant.toISOString(),
      });
      if (result.ok) {
        setSaved(true);
        setSummary('');
        setOutcome('');
      } else {
        setProblem(result.problem);
      }
    } catch {
      setProblem({ title: 'Échange non enregistré', detail: 'Connexion interrompue. Vérifiez le journal avant de réessayer.', status: 0 });
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-labelledby={ids.section}>
      <h3 id={ids.section}>Consigner un échange</h3>
      <form onSubmit={(event) => { void send(event); }} noValidate>
        <label htmlFor={ids.channel}>Canal</label>
        <select id={ids.channel} value={channel} onChange={(event) => { setChannel(event.target.value); setSaved(false); }}>
          {CHANNELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label htmlFor={ids.direction}>Sens</label>
        <select id={ids.direction} value={direction} onChange={(event) => { setDirection(event.target.value); setSaved(false); }}>
          {DIRECTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <TextArea id={ids.summary} label="Résumé de l’échange" value={summary} error={summaryError} onChange={(event) => { setSummary(event.target.value); setSaved(false); }} />
        <TextField id={ids.outcome} label="Issue (facultatif)" value={outcome} onChange={(event) => { setOutcome(event.target.value); setSaved(false); }} />
        <label htmlFor={ids.occurredAt}>Instant de l’échange</label>
        <input id={ids.occurredAt} type="datetime-local" value={occurredAt} onChange={(event) => { setOccurredAt(event.target.value); setSaved(false); }} />
        {timeError === null ? null : <p role="alert">{timeError}</p>}
        <Button type="submit" disabled={pending}>Consigner l’échange</Button>
      </form>
      {problem === null ? null : <ErrorState problem={problem} />}
      {saved ? <p role="status">Échange consigné au journal du client.</p> : null}
    </section>
  );
}

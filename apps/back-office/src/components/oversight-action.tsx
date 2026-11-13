'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { useId, useState, type ReactElement } from 'react';

export type OversightKind = 'alert' | 'gap' | 'suspense' | 'complaint';
export type OversightPort = (input: {
  readonly path: string;
  readonly body: Readonly<Record<string, string>>;
}) => Promise<{ readonly ok: true } | { readonly ok: false; readonly problem: ProblemSummary }>;

/**
 * D53–D56 / D62 : action de contrôle depuis la file — alerte de fraude
 * (motif obligatoire), classement d'un écart, justification du suspens,
 * clôture d'une réclamation. Le serveur et la base gardent les règles
 * (maker-checker, rôles) ; les refus sont affichés tels quels.
 */
export function OversightAction({
  kind,
  id,
  act,
  onDone,
}: {
  readonly kind: OversightKind;
  readonly id: string;
  readonly act: OversightPort;
  readonly onDone: () => void;
}): ReactElement {
  const ids = { text: useId(), select: useId() };
  const [text, setText] = useState('');
  const [choice, setChoice] = useState(kind === 'gap' ? 'IN_TRANSIT' : 'ANSWERED');
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);
  const encoded = encodeURIComponent(id);

  async function send(path: string, body: Record<string, string>): Promise<void> {
    setPending(true);
    setProblem(null);
    try {
      const result = await act({ path, body });
      if (result.ok) {
        onDone();
      } else {
        setProblem(result.problem);
      }
    } catch {
      setProblem({ title: 'Action impossible', detail: 'Une connexion réseau est nécessaire.' });
    } finally {
      setPending(false);
    }
  }

  function requireText(then: (value: string) => void): void {
    const value = text.trim();
    if (value.length === 0) {
      setError('Motif obligatoire.');
      return;
    }
    setError(undefined);
    then(value);
  }

  const select = (label: string, options: readonly (readonly [string, string])[]): ReactElement => (
    <div className="achat-field">
      <label className="achat-field__label" htmlFor={ids.select}>{label}</label>
      <select id={ids.select} className="achat-field__input" value={choice} onChange={(event) => { setChoice(event.target.value); }}>
        {options.map(([value, name]) => (
          <option key={value} value={value}>{name}</option>
        ))}
      </select>
    </div>
  );

  let controls: ReactElement;
  if (kind === 'alert') {
    controls = (
      <>
        <TextField id={ids.text} label="Motif" value={text} error={error} onChange={(event) => { setText(event.target.value); }} />
        <Button disabled={pending} onClick={() => { requireText((reason) => void send(`/v1/backoffice/risk/alerts/${encoded}/decision`, { decision: 'DISMISSED', reason })); }}>
          Classer sans suite
        </Button>
        <Button variant="danger" disabled={pending} onClick={() => { requireText((reason) => void send(`/v1/backoffice/risk/alerts/${encoded}/decision`, { decision: 'CONFIRMED', reason })); }}>
          Confirmer la fraude
        </Button>
      </>
    );
  } else if (kind === 'gap') {
    controls = (
      <>
        {select('Classe', [['IN_TRANSIT', 'En transit'], ['FEES', 'Frais'], ['DUPLICATE', 'Doublon'], ['UNKNOWN', 'Inconnu']])}
        <TextField id={ids.text} label="Explication" value={text} error={error} onChange={(event) => { setText(event.target.value); }} />
        <Button disabled={pending} onClick={() => { requireText((explanation) => void send(`/v1/backoffice/reconciliation/incidents/${encoded}/classifications`, { classification: choice, explanation })); }}>
          Proposer la classe
        </Button>
      </>
    );
  } else if (kind === 'suspense') {
    controls = (
      <>
        <TextField id={ids.text} label="Explication" value={text} error={error} onChange={(event) => { setText(event.target.value); }} />
        <Button disabled={pending} onClick={() => { requireText((explanation) => void send(`/v1/backoffice/reconciliation/suspense/${encoded}/justification`, { explanation })); }}>
          Justifier
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => void send(`/v1/backoffice/reconciliation/suspense/${encoded}/approval`, {})}>
          Valider la justification
        </Button>
      </>
    );
  } else {
    controls = (
      <>
        {select('Issue', [['ANSWERED', 'Répondue'], ['WITHDRAWN', 'Retirée par le client']])}
        <Button disabled={pending} onClick={() => void send(`/v1/backoffice/complaints/${encoded}/closure`, { outcome: choice })}>
          Clore la réclamation
        </Button>
      </>
    );
  }
  return (
    <div className="achat-oversight-action">
      {problem === null ? null : <ErrorState problem={problem} headingLevel={3} />}
      {controls}
    </div>
  );
}

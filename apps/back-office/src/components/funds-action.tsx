'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { useId, useState, type ReactElement } from 'react';

export type FundsFlow = 'refunds' | 'beneficiary-payouts' | 'settlements';
export type FundsStep = 'decision' | 'instruction' | 'execution';
export type FundsActionPort = (input: {
  readonly flow: FundsFlow;
  readonly id: string;
  readonly step: FundsStep;
  readonly body: Readonly<Record<string, string>>;
}) => Promise<{ readonly ok: true } | { readonly ok: false; readonly problem: ProblemSummary }>;

const BANK_REFERENCE = /^[A-Za-z0-9._:/-]{1,100}$/;

/**
 * D46, D49, D50 / D62 : action suivante d'une sortie de fonds depuis la file.
 * L'écran ne décide rien : rôles, plafonds, préparateur ≠ décideur et émetteur
 * ≠ confirmateur sont vérifiés par le serveur et la base ; les refus sont affichés.
 */
export function FundsAction({
  flow,
  id,
  stage,
  act,
  onDone,
}: {
  readonly flow: FundsFlow;
  readonly id: string;
  readonly stage: string;
  readonly act: FundsActionPort;
  readonly onDone: () => void;
}): ReactElement | null {
  const ids = { reason: useId(), city: useId(), reference: useId(), outcome: useId() };
  const [reason, setReason] = useState('');
  const [city, setCity] = useState<'yaounde' | 'douala'>('douala');
  const [reference, setReference] = useState('');
  const [outcome, setOutcome] = useState<'EXECUTED' | 'REJECTED'>('EXECUTED');
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);
  const withCity = (body: Record<string, string>): Record<string, string> => (flow === 'settlements' ? { ...body, cityId: city } : body);

  async function send(step: FundsStep, body: Record<string, string>): Promise<void> {
    setPending(true);
    setProblem(null);
    try {
      const result = await act({ flow, id, step, body: withCity(body) });
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

  const citySelect =
    flow === 'settlements' ? (
      <div className="achat-field">
        <label className="achat-field__label" htmlFor={ids.city}>Ville</label>
        <select id={ids.city} className="achat-field__input" value={city} onChange={(event) => { setCity(event.target.value === 'yaounde' ? 'yaounde' : 'douala'); }}>
          <option value="douala">Douala</option>
          <option value="yaounde">Yaoundé</option>
        </select>
      </div>
    ) : null;

  let controls: ReactElement | null = null;
  if (stage === 'AWAITING_DECISION') {
    controls = (
      <>
        <TextField id={ids.reason} label="Motif" value={reason} error={error} onChange={(event) => { setReason(event.target.value); }} />
        <Button disabled={pending} onClick={() => void send('decision', { decision: 'APPROVED' })}>Approuver</Button>
        <Button
          variant="danger"
          disabled={pending}
          onClick={() => {
            if (reason.trim().length === 0) {
              setError('Un refus exige un motif.');
              return;
            }
            setError(undefined);
            void send('decision', { decision: 'REJECTED', reason: reason.trim() });
          }}
        >
          Refuser
        </Button>
      </>
    );
  } else if (stage === 'AWAITING_INSTRUCTION') {
    controls = <Button disabled={pending} onClick={() => void send('instruction', {})}>Émettre l’instruction signée</Button>;
  } else if (stage === 'AWAITING_EXECUTION') {
    controls = (
      <>
        <div className="achat-field">
          <label className="achat-field__label" htmlFor={ids.outcome}>Issue</label>
          <select id={ids.outcome} className="achat-field__input" value={outcome} onChange={(event) => { setOutcome(event.target.value === 'REJECTED' ? 'REJECTED' : 'EXECUTED'); }}>
            <option value="EXECUTED">Exécuté par l’établissement</option>
            <option value="REJECTED">Refusé par l’établissement</option>
          </select>
        </div>
        <TextField id={ids.reference} label="Référence de l’établissement" value={reference} error={error} onChange={(event) => { setReference(event.target.value.trim()); }} />
        <Button
          disabled={pending}
          onClick={() => {
            if (!BANK_REFERENCE.test(reference)) {
              setError('Référence de l’établissement invalide (lettres, chiffres, . _ : / -).');
              return;
            }
            setError(undefined);
            void send('execution', { outcome, bankReference: reference });
          }}
        >
          Enregistrer l’exécution
        </Button>
      </>
    );
  }
  if (controls === null) {
    return null;
  }
  return (
    <div className="achat-funds-action">
      {problem === null ? null : <ErrorState problem={problem} headingLevel={3} />}
      {citySelect}
      {controls}
    </div>
  );
}

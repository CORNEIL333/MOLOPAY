'use client';
import { useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextArea } from '@achat/ui';
import { getDictionary, type Locale } from '../i18n';
import { formatDateTime } from '../lib/date';

type Receipt = components['schemas']['ClaimReceipt'];
type Reason = components['schemas']['ClaimRequest']['reason'];
const REASONS: readonly Reason[] = ['PAYMENT_NOT_RECEIVED', 'HANDOVER_REFUSED', 'OFFER_MISMATCH', 'OTHER'];

/** Envoi injecté (navigateur : route réelle `POST /v1/goals/{goalId}/claims`). */
export type ClaimPort = (claim: { readonly reason: Reason; readonly details: string }) => Promise<
  { readonly ok: true; readonly receipt: Receipt } | { readonly ok: false; readonly problem: ProblemSummary }
>;

/** F-SUP-001 / D70 : réclamation sur un objectif ; accusé immédiat avec numéro à communiquer au support. */
export function ClaimForm({ locale, submit }: { readonly locale: Locale; readonly submit: ClaimPort }): ReactElement {
  const labels = getDictionary(locale).claim;
  const ids = { reason: useId(), details: useId() };
  const [reason, setReason] = useState<Reason>('PAYMENT_NOT_RECEIVED');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const text = details.trim();
    if (text.length < 10 || text.length > 1000) {
      setError(labels.invalid);
      return;
    }
    if (sending.current) return;
    sending.current = true;
    setError(undefined);
    setProblem(null);
    setPending(true);
    try {
      const result = await submit({ reason, details: text });
      if (result.ok) {
        setReceipt(result.receipt);
        setDetails('');
      } else {
        setProblem(result.problem);
      }
    } catch {
      setProblem({ title: labels.error, detail: labels.network });
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-busy={pending}>
      <h2>{labels.title}</h2>
      {receipt === null ? null : (
        <p role="status">
          {labels.received} {receipt.reference} · <time dateTime={receipt.createdAt}>{formatDateTime(receipt.createdAt, locale)}</time>
        </p>
      )}
      {problem === null ? null : <ErrorState problem={problem} headingLevel={3} />}
      <form onSubmit={(event) => void send(event)} noValidate>
        <div className="achat-field">
          <label className="achat-field__label" htmlFor={ids.reason}>{labels.reason}</label>
          <select id={ids.reason} className="achat-field__input" value={reason} onChange={(event) => { const value = event.target.value; if ((REASONS as readonly string[]).includes(value)) setReason(value as Reason); }}>
            {REASONS.map((value) => <option key={value} value={value}>{labels.reasons[value]}</option>)}
          </select>
        </div>
        <TextArea id={ids.details} label={labels.details} value={details} error={error} onChange={(event) => { setDetails(event.target.value); }} />
        <p>{labels.privacy}</p>
        <Button type="submit" disabled={pending}>{labels.submit}</Button>
      </form>
    </section>
  );
}

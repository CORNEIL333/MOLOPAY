'use client';
import { useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { getDictionary, type Locale } from '../i18n';

/** Envoi injecté (navigateur : `browserLegalNamePort`) ; une clé d'idempotence par intention. */
export type LegalNamePort = (legalName: string) => Promise<
  { readonly ok: true; readonly kycLevel: 'NONE' | 'BASIC' | 'STRONG'; readonly verification: 'COMPLETED' | 'IN_PROGRESS' } | { readonly ok: false; readonly problem: ProblemSummary }
>;

/**
 * REG-LBC-001 / D68 : le client déclare son nom légal (niveau 1). Le
 * résultat affiché reste neutre : « vérification en cours » ne révèle jamais
 * pourquoi (interdiction d'alerter la personne, LBC/FT).
 */
export function LegalNameForm({ locale, submit }: { readonly locale: Locale; readonly submit: LegalNamePort }): ReactElement {
  const labels = getDictionary(locale).legalName;
  const nameId = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [outcome, setOutcome] = useState<'COMPLETED' | 'IN_PROGRESS' | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const legalName = name.replace(/\s+/g, ' ').trim();
    if (legalName.length < 2 || legalName.length > 200) {
      setError(labels.invalid);
      return;
    }
    if (sending.current) return;
    sending.current = true;
    setError(undefined);
    setProblem(null);
    setPending(true);
    try {
      const result = await submit(legalName);
      if (result.ok) {
        setOutcome(result.verification);
        setName('');
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
      <h1 className="page-title">{labels.title}</h1>
      <p className="page-subtitle">{labels.description}</p>
      {outcome === null ? null : <p role="status">{outcome === 'COMPLETED' ? labels.completed : labels.inProgress}</p>}
      {problem === null ? null : <ErrorState problem={problem} />}
      <form onSubmit={(event) => void send(event)} noValidate>
        <TextField id={nameId} label={labels.label} autoComplete="name" value={name} error={error} onChange={(event) => { setName(event.target.value); }} />
        <Button type="submit" disabled={pending}>{labels.submit}</Button>
      </form>
      <a href="/compte">{labels.back}</a>
    </section>
  );
}

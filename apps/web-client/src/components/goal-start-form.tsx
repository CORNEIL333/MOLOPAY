'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState } from '@achat/ui';
import type { FormEvent, ReactElement } from 'react';
import { useId, useRef, useState } from 'react';
import type { Dictionary } from '../i18n';
import { browserApi } from '../lib/browser-api';
import { problemFrom } from '../lib/problem';
import { TERMS_VERSION } from '../lib/terms';

type Goal = components['schemas']['Goal'];
type GoalRequest = components['schemas']['GoalRequest'];
type Quote = components['schemas']['Quote'];

export type GoalOutcome =
  | { readonly ok: true; readonly goal: Goal }
  | { readonly ok: false; readonly problem: ProblemSummary };

async function createDefaultGoal(
  input: GoalRequest,
  fallbackTitle: string,
): Promise<GoalOutcome> {
  const response = await browserApi().POST('/v1/goals', {
    params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    body: input,
    cache: 'no-store',
  });
  if (response.data !== undefined) return { ok: true, goal: response.data };
  return {
    ok: false,
    problem: problemFrom(response.error, response.response, fallbackTitle),
  };
}

export function GoalStartForm({
  offerId,
  quote,
  labels,
  createGoal,
  onComplete,
}: {
  readonly offerId: string;
  readonly quote: Quote;
  readonly labels: Dictionary['offer'];
  readonly createGoal?: (input: GoalRequest) => Promise<GoalOutcome>;
  readonly onComplete?: (goal: Goal) => void;
}): ReactElement {
  const id = useId();
  const [accepted, setAccepted] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || submitting.current) return;
    setProblem(null);
    if (!accepted) {
      setTermsError(labels.termsRequired);
      return;
    }
    setTermsError(null);
    submitting.current = true;
    setPending(true);
    try {
      if (quote.model !== 'SAVE_THEN_BUY') {
        // Seul le modèle A part d'une offre ; B est fermé (D26), C part d'un bénéficiaire.
        setProblem({ title: labels.startErrorTitle });
        return;
      }
      const input: GoalRequest = {
        model: 'SAVE_THEN_BUY',
        offerId,
        planId: quote.planId,
        durationMonths: quote.durationMonths,
        acceptTermsVersion: TERMS_VERSION,
      };
      const outcome = createGoal === undefined
        ? await createDefaultGoal(input, labels.startErrorTitle)
        : await createGoal(input);
      if (outcome.ok) {
        if (onComplete === undefined) {
          window.location.assign(`/objectifs/${encodeURIComponent(outcome.goal.goalId)}`);
        } else {
          onComplete(outcome.goal);
        }
      } else {
        setProblem(outcome.problem);
      }
    } catch {
      setProblem({ title: labels.startErrorTitle });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <section className="goal-start" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="quote-result__subtitle">
        {labels.startTitle}
      </h3>
      {problem === null ? null : <ErrorState problem={problem} />}
      <form className="goal-start__form" noValidate onSubmit={(event) => void submit(event)}>
        <div className="achat-field">
          <label className="goal-start__terms" htmlFor={`${id}-terms`}>
            <input
              id={`${id}-terms`}
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.currentTarget.checked)}
              disabled={pending}
              aria-invalid={termsError === null ? undefined : true}
              aria-describedby={termsError === null ? undefined : `${id}-terms-error`}
            />
            <span>{labels.termsLabel}</span>
          </label>
          {termsError === null ? null : (
            <p id={`${id}-terms-error`} className="achat-field__error" role="alert">
              {termsError}
            </p>
          )}
        </div>
        <Button type="submit" disabled={pending}>
          {labels.startButton}
        </Button>
      </form>
      <a href="/connexion">{labels.loginToStart}</a>
    </section>
  );
}

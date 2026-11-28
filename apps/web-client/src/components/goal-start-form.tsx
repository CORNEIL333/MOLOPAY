'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, SlideToConfirm } from '@achat/ui';
import type { FormEvent, ReactElement } from 'react';
import { useId, useRef, useState } from 'react';
import type { Dictionary, Locale } from '../i18n';
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

export type GoalStartLabels = Pick<
  Dictionary['offer'],
  'startTitle' | 'termsLabel' | 'termsRequired' | 'startButton' | 'startErrorTitle' | 'loginToStart'
>;

export function GoalStartForm({
  offerId,
  quote,
  labels,
  locale = 'fr',
  createGoal,
  onComplete,
}: {
  readonly offerId: string;
  readonly quote: Quote;
  readonly labels: GoalStartLabels;
  readonly locale?: Locale;
  readonly createGoal?: (input: GoalRequest) => Promise<GoalOutcome>;
  readonly onComplete?: (goal: Goal) => void;
}): ReactElement {
  const id = useId();
  const isEn = locale === 'en';
  const [accepted, setAccepted] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  async function runCreate(): Promise<void> {
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

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void runCreate();
  }

  return (
    <section className="goal-start" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="quote-result__subtitle">
        {labels.startTitle}
      </h3>
      <p className="mp-sub">
        <strong>{isEn ? '3. Read the agreement' : '3. Relire l’accord'}</strong>
      </p>
      <ul>
        <li>
          {isEn
            ? 'Cancel any time before locking: 100% refunded, no fees.'
            : 'Annulation à tout moment avant verrouillage : remboursé à 100 %, sans frais.'}
        </li>
        <li>
          {isEn
            ? 'Shop out of stock: equivalent item or full refund.'
            : 'Boutique en rupture : article équivalent ou remboursement intégral.'}
        </li>
      </ul>
      {problem === null ? null : <ErrorState problem={problem} />}
      <form className="goal-start__form" noValidate onSubmit={submit}>
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
        <SlideToConfirm
          label={isEn ? 'Slide to sign' : 'Glissez pour signer'}
          confirmActionLabel={isEn ? 'Sign with keyboard' : 'Signer au clavier'}
          locked={pending}
          onConfirm={() => { void runCreate(); }}
        />
        <Button type="submit" disabled={pending}>
          {labels.startButton}
        </Button>
      </form>
      <a href="/connexion">{labels.loginToStart}</a>
    </section>
  );
}

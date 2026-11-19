'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, EmptyState, ErrorState, TextField } from '@achat/ui';
import type { FormEvent, ReactElement } from 'react';
import { useId, useRef, useState } from 'react';
import { getDictionary, type Locale } from '../i18n';
import { browserApi } from '../lib/browser-api';
import { problemFrom } from '../lib/problem';
import { TERMS_VERSION } from '../lib/terms';

type Goal = components['schemas']['Goal'];
type GoalRequest = components['schemas']['GoalRequest'];
type PaymentPlan = components['schemas']['PaymentPlan'];

export type PlannedExpenseOutcome =
  | { readonly ok: true; readonly goal: Goal }
  | { readonly ok: false; readonly problem: ProblemSummary };

const POSITIVE_INT_XAF = /^[1-9][0-9]*$/;

async function defaultCreateGoal(
  input: GoalRequest,
  fallbackTitle: string,
): Promise<PlannedExpenseOutcome> {
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

export function PlannedExpenseForm({
  plans,
  locale,
  createGoal,
  onComplete,
}: {
  readonly plans: readonly PaymentPlan[];
  readonly locale: Locale;
  readonly createGoal?: (input: GoalRequest) => Promise<PlannedExpenseOutcome>;
  readonly onComplete?: (goal: Goal) => void;
}): ReactElement {
  const id = useId();
  const dict = getDictionary(locale);
  const t = dict.plannedExpense;
  const plannedPlans = plans.filter((plan) => plan.model === 'PLANNED_EXPENSE');
  const firstPlan = plannedPlans[0];

  const [beneficiaryId, setBeneficiaryId] = useState('');
  const [targetXaf, setTargetXaf] = useState('');
  const [planId, setPlanId] = useState(firstPlan?.planId ?? '');
  const [durationRaw, setDurationRaw] = useState(
    firstPlan === undefined ? '3' : String(Math.min(3, firstPlan.maxDurationMonths)),
  );
  const [accepted, setAccepted] = useState(false);

  const [beneficiaryError, setBeneficiaryError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [durationError, setDurationError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  if (plannedPlans.length === 0) {
    return (
      <section aria-labelledby={`${id}-title`}>
        <h1 id={`${id}-title`} className="page-title">{t.title}</h1>
        <EmptyState title={t.title} description={t.noPlans} />
        <a href="/objectifs">{t.backToGoals}</a>
      </section>
    );
  }

  const selectedPlan = plannedPlans.find((plan) => plan.planId === planId) ?? plannedPlans[0];

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || submitting.current || selectedPlan === undefined) return;
    setProblem(null);

    const trimmedBen = beneficiaryId.trim();
    const trimmedTarget = targetXaf.trim();
    const durationNum = Number.parseInt(durationRaw.trim(), 10);

    const benOk = trimmedBen.length > 0;
    const targetOk = POSITIVE_INT_XAF.test(trimmedTarget);
    const durationOk =
      /^[1-9][0-9]*$/.test(durationRaw.trim()) &&
      durationNum >= 1 &&
      durationNum <= selectedPlan.maxDurationMonths;

    setBeneficiaryError(benOk ? null : t.beneficiaryRequired);
    setTargetError(targetOk ? null : t.targetInvalid);
    setDurationError(durationOk ? null : t.durationInvalid);
    setTermsError(accepted ? null : t.termsRequired);

    if (!benOk || !targetOk || !durationOk || !accepted) {
      return;
    }

    submitting.current = true;
    setPending(true);
    try {
      const input: GoalRequest = {
        model: 'PLANNED_EXPENSE',
        beneficiaryId: trimmedBen,
        targetXaf: BigInt(trimmedTarget).toString(),
        planId: selectedPlan.planId,
        durationMonths: durationNum,
        acceptTermsVersion: TERMS_VERSION,
      };
      const outcome = createGoal === undefined
        ? await defaultCreateGoal(input, t.errorTitle)
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
      setProblem({ title: t.errorTitle, detail: dict.errors.network });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} aria-busy={pending}>
      <h1 id={`${id}-title`} className="page-title">{t.title}</h1>
      <p className="page-subtitle">{t.subtitle}</p>
      {problem === null ? null : <ErrorState problem={problem} />}
      <form noValidate onSubmit={(event) => { void submit(event); }}>
        <TextField
          id={`${id}-beneficiary`}
          label={t.beneficiaryLabel}
          error={beneficiaryError ?? undefined}
          value={beneficiaryId}
          onChange={(event) => { setBeneficiaryId(event.currentTarget.value); }}
          disabled={pending}
          required
        />
        <TextField
          id={`${id}-target`}
          label={t.targetLabel}
          error={targetError ?? undefined}
          inputMode="numeric"
          value={targetXaf}
          onChange={(event) => { setTargetXaf(event.currentTarget.value); }}
          disabled={pending}
          required
        />
        <div className="achat-field">
          <label htmlFor={`${id}-plan`}>{t.planLabel}</label>
          <select
            id={`${id}-plan`}
            value={selectedPlan?.planId ?? ''}
            onChange={(event) => { setPlanId(event.currentTarget.value); }}
            disabled={pending}
          >
            {plannedPlans.map((plan) => (
              <option key={plan.planId} value={plan.planId}>
                {`${dict.offer.rhythms[plan.rhythm]} · max ${plan.maxDurationMonths.toString()} ${dict.offer.planMaxSuffix}`}
              </option>
            ))}
          </select>
        </div>
        <TextField
          id={`${id}-duration`}
          label={t.durationLabel}
          error={durationError ?? undefined}
          inputMode="numeric"
          value={durationRaw}
          onChange={(event) => { setDurationRaw(event.currentTarget.value); }}
          disabled={pending}
          required
        />
        <div className="achat-field">
          <label className="goal-start__terms" htmlFor={`${id}-terms`}>
            <input
              id={`${id}-terms`}
              type="checkbox"
              checked={accepted}
              onChange={(event) => { setAccepted(event.currentTarget.checked); }}
              disabled={pending}
              aria-invalid={termsError === null ? undefined : true}
              aria-describedby={termsError === null ? undefined : `${id}-terms-error`}
            />
            <span>{t.termsLabel}</span>
          </label>
          {termsError === null ? null : (
            <p id={`${id}-terms-error`} role="alert">{termsError}</p>
          )}
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? t.pending : t.submitButton}
        </Button>
      </form>
    </section>
  );
}

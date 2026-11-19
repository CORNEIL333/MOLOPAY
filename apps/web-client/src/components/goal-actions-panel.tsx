'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import type { FormEvent, ReactElement } from 'react';
import { useId, useRef, useState } from 'react';
import { getDictionary, type Locale } from '../i18n';
import { browserApi } from '../lib/browser-api';
import { problemFrom } from '../lib/problem';

type Goal = components['schemas']['Goal'];
type GoalSigningPayload = components['schemas']['GoalSigningPayload'];
type GoalSignedActionRequest = components['schemas']['GoalSignedActionRequest'];

type GoalMutationOutcome =
  | { readonly ok: true; readonly goal: Goal }
  | { readonly ok: false; readonly problem: ProblemSummary };

type SigningPayloadOutcome =
  | { readonly ok: true; readonly payload: GoalSigningPayload }
  | { readonly ok: false; readonly problem: ProblemSummary };

export type GoalActionsPorts = {
  readonly lock?: (goalId: string, pin: string) => Promise<GoalMutationOutcome>;
  readonly getSigningPayload?: (goalId: string, transition: 'ACTIVATE' | 'CANCEL') => Promise<SigningPayloadOutcome>;
  readonly signPayload?: (payloadBase64: string) => Promise<string>;
  readonly activate?: (goalId: string, body: GoalSignedActionRequest) => Promise<GoalMutationOutcome>;
  readonly cancel?: (goalId: string, body: GoalSignedActionRequest) => Promise<GoalMutationOutcome>;
};

type Mode = 'LOCK' | 'ACTIVATE' | 'CANCEL';

const PIN_PATTERN = /^[0-9]{6}$/;

async function defaultLock(goalId: string, pin: string, fallback: string): Promise<GoalMutationOutcome> {
  const response = await browserApi().POST('/v1/goals/{goalId}/lock', {
    params: { path: { goalId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
    body: { pin },
    cache: 'no-store',
  });
  if (response.data !== undefined) return { ok: true, goal: response.data };
  return { ok: false, problem: problemFrom(response.error, response.response, fallback) };
}

async function defaultGetSigningPayload(
  goalId: string,
  transition: 'ACTIVATE' | 'CANCEL',
  fallback: string,
): Promise<SigningPayloadOutcome> {
  const response = await browserApi().GET('/v1/goals/{goalId}/signing-payload', {
    params: { path: { goalId }, query: { transition } },
    cache: 'no-store',
  });
  if (response.data !== undefined) return { ok: true, payload: response.data };
  return { ok: false, problem: problemFrom(response.error, response.response, fallback) };
}

async function defaultActivate(goalId: string, body: GoalSignedActionRequest, fallback: string): Promise<GoalMutationOutcome> {
  const response = await browserApi().POST('/v1/goals/{goalId}/activation', {
    params: { path: { goalId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
    body,
    cache: 'no-store',
  });
  if (response.data !== undefined) return { ok: true, goal: response.data };
  return { ok: false, problem: problemFrom(response.error, response.response, fallback) };
}

async function defaultCancel(goalId: string, body: GoalSignedActionRequest, fallback: string): Promise<GoalMutationOutcome> {
  const response = await browserApi().POST('/v1/goals/{goalId}/cancellation', {
    params: { path: { goalId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
    body,
    cache: 'no-store',
  });
  if (response.data !== undefined) return { ok: true, goal: response.data };
  return { ok: false, problem: problemFrom(response.error, response.response, fallback) };
}

export function GoalActionsPanel({
  goal,
  locale,
  ports,
}: {
  readonly goal: Goal;
  readonly locale: Locale;
  readonly ports?: GoalActionsPorts;
}): ReactElement | null {
  const id = useId();
  const dict = getDictionary(locale);
  const t = dict.goalActions;
  const [currentGoal, setCurrentGoal] = useState<Goal>(goal);
  const [mode, setMode] = useState<Mode | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  const canActivate = currentGoal.status === 'DRAFT';
  const canLock = currentGoal.status === 'ACTIVE' && !currentGoal.locked;
  const canCancel = currentGoal.status === 'ACTIVE' && !currentGoal.locked;

  if (!canActivate && !canLock && !canCancel && statusMessage === null) {
    return null;
  }

  function openMode(next: Mode): void {
    setMode(next);
    setPin('');
    setPinError(null);
    setProblem(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (mode === null || pending || submitting.current) return;
    setProblem(null);
    if (!PIN_PATTERN.test(pin)) {
      setPinError(t.pinInvalid);
      return;
    }
    setPinError(null);
    submitting.current = true;
    setPending(true);
    try {
      if (mode === 'LOCK') {
        const outcome = ports?.lock !== undefined
          ? await ports.lock(currentGoal.goalId, pin)
          : await defaultLock(currentGoal.goalId, pin, t.errorTitle);
        setPin('');
        if (outcome.ok) {
          setCurrentGoal(outcome.goal);
          setMode(null);
          setStatusMessage(t.lockDone);
        } else {
          setProblem(outcome.problem);
        }
        return;
      }

      if (ports?.signPayload === undefined) {
        setPin('');
        setStatusMessage(t.deviceKeyUnavailable);
        return;
      }

      const payloadRes = ports.getSigningPayload !== undefined
        ? await ports.getSigningPayload(currentGoal.goalId, mode)
        : await defaultGetSigningPayload(currentGoal.goalId, mode, t.errorTitle);
      if (!payloadRes.ok) {
        setPin('');
        setProblem(payloadRes.problem);
        return;
      }
      const signature = await ports.signPayload(payloadRes.payload.payloadBase64);
      const body: GoalSignedActionRequest = { pin, signature };
      const outcome = mode === 'ACTIVATE'
        ? (ports.activate !== undefined
          ? await ports.activate(currentGoal.goalId, body)
          : await defaultActivate(currentGoal.goalId, body, t.errorTitle))
        : (ports.cancel !== undefined
          ? await ports.cancel(currentGoal.goalId, body)
          : await defaultCancel(currentGoal.goalId, body, t.errorTitle));
      setPin('');
      if (outcome.ok) {
        setCurrentGoal(outcome.goal);
        setMode(null);
        setStatusMessage(mode === 'ACTIVATE' ? t.activateDone : t.cancelDone);
      } else {
        setProblem(outcome.problem);
      }
    } catch {
      setPin('');
      setProblem({ title: t.errorTitle, detail: dict.errors.network });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  const requiresDeviceKey = (mode === 'ACTIVATE' || mode === 'CANCEL') && ports?.signPayload === undefined;
  const confirmLabel = mode === 'LOCK'
    ? t.lockConfirmButton
    : mode === 'ACTIVATE'
      ? t.activateConfirmButton
      : t.cancelConfirmButton;
  const helpText = mode === 'LOCK'
    ? t.lockHelp
    : mode === 'ACTIVATE'
      ? t.activateHelp
      : t.cancelHelp;

  return (
    <section aria-labelledby={`${id}-title`} aria-busy={pending}>
      <h2 id={`${id}-title`}>{t.title}</h2>
      {statusMessage === null ? null : <p role="status">{statusMessage}</p>}
      {problem === null ? null : <ErrorState problem={problem} />}
      <div className="catalog-filters__actions">
        {canActivate ? (
          <Button type="button" disabled={pending} onClick={() => { openMode('ACTIVATE'); }}>
            {t.activateButton}
          </Button>
        ) : null}
        {canLock ? (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => { openMode('LOCK'); }}>
            {t.lockButton}
          </Button>
        ) : null}
        {canCancel ? (
          <Button type="button" variant="danger" disabled={pending} onClick={() => { openMode('CANCEL'); }}>
            {t.cancelGoalButton}
          </Button>
        ) : null}
      </div>

      {mode === null ? null : requiresDeviceKey ? (
        <div role="status">
          <p>{t.deviceKeyUnavailable}</p>
          <Button type="button" variant="secondary" onClick={() => { setMode(null); }}>
            {t.closeButton}
          </Button>
        </div>
      ) : (
        <form noValidate onSubmit={(event) => { void submit(event); }}>
          <p>{helpText}</p>
          <TextField
            id={`${id}-pin`}
            label={t.pinLabel}
            error={pinError ?? undefined}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(event) => { setPin(event.currentTarget.value); }}
            disabled={pending}
            required
          />
          <div className="catalog-filters__actions">
            <Button type="submit" variant={mode === 'CANCEL' ? 'danger' : 'primary'} disabled={pending}>
              {pending ? t.pending : confirmLabel}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => { setMode(null); setPin(''); }}>
              {t.closeButton}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

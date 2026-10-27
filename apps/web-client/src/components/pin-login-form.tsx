'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import type { FormEvent, ReactElement } from 'react';
import { useId, useRef, useState } from 'react';
import type { Dictionary, Locale } from '../i18n';
import { browserApi } from '../lib/browser-api';
import { problemFrom } from '../lib/problem';
import type { AuthOutcome } from './phone-otp-form';

type SessionRequest = components['schemas']['SessionRequest'];
type SessionSummary = components['schemas']['SessionSummary'];

const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const PIN_PATTERN = /^[0-9]{6}$/;

async function loginDefault(
  input: SessionRequest,
  fallbackTitle: string,
): Promise<AuthOutcome<SessionSummary>> {
  const response = await browserApi().POST('/v1/auth/sessions', {
    body: input,
    params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    cache: 'no-store',
  });
  if (response.data !== undefined) {
    return { ok: true, value: response.data };
  }
  return {
    ok: false,
    problem: problemFrom(response.error, response.response, fallbackTitle),
  };
}

export function PinLoginForm({
  labels,
  login,
  onComplete,
}: {
  readonly labels: Dictionary['auth'];
  readonly locale?: Locale;
  readonly login?: (input: SessionRequest) => Promise<AuthOutcome<SessionSummary>>;
  readonly onComplete?: () => void;
}): ReactElement {
  const id = useId();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || submitting.current) {
      return;
    }
    const validPhone = PHONE_PATTERN.test(phone);
    const validPin = PIN_PATTERN.test(pin);
    setPhoneError(validPhone ? null : labels.invalidPhone);
    setPinError(validPin ? null : labels.pinInvalid);
    setProblem(null);
    if (!validPhone || !validPin) {
      return;
    }

    submitting.current = true;
    setPending(true);
    try {
      const input: SessionRequest = { phone, pin };
      const outcome = login === undefined
        ? await loginDefault(input, labels.errorTitle)
        : await login(input);
      if (outcome.ok) {
        setPin('');
        if (onComplete === undefined) {
          window.location.assign('/objectifs');
        } else {
          onComplete();
        }
      } else {
        setProblem(outcome.problem);
      }
    } catch {
      setProblem({ title: labels.errorTitle });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <section className="auth-panel" aria-labelledby={`${id}-title`}>
      <h1 id={`${id}-title`} className="page-title">
        {labels.loginTitle}
      </h1>
      <p id={`${id}-hint`}>{labels.loginHint}</p>
      {problem === null ? null : <ErrorState problem={problem} />}
      <form
        className="auth-form"
        noValidate
        aria-describedby={`${id}-hint`}
        aria-busy={pending}
        onSubmit={(event) => void submit(event)}
      >
        <TextField
          id={`${id}-phone`}
          label={labels.phoneLabel}
          hint={labels.phoneHint}
          error={phoneError ?? undefined}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          name="phone"
          value={phone}
          onChange={(event) => setPhone(event.currentTarget.value)}
          disabled={pending}
          required
        />
        <TextField
          id={`${id}-pin`}
          label={labels.pinLabel}
          error={pinError ?? undefined}
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          maxLength={6}
          pattern="[0-9]{6}"
          name="pin"
          value={pin}
          onChange={(event) => setPin(event.currentTarget.value)}
          disabled={pending}
          required
        />
        <Button type="submit" block disabled={pending}>
          {labels.loginButton}
        </Button>
        <a className="auth-form__link" href="/inscription">
          {labels.title}
        </a>
      </form>
    </section>
  );
}

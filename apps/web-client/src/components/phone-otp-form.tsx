'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import type { Locale } from '../i18n';
import { browserApi } from '../lib/browser-api';
import { problemFrom } from '../lib/problem';

type OtpChallenge = components['schemas']['OtpChallenge'];
type OtpVerification = components['schemas']['OtpVerification'];
type SessionSummary = components['schemas']['SessionSummary'];

export type SignupInput = {
  readonly phone: string;
  readonly challengeId: string;
  readonly signupToken: string;
  readonly pin: string;
  readonly locale: Locale;
};

export type AuthOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: ProblemSummary };

export type PhoneOtpLabels = {
  readonly title: string;
  readonly phoneLabel: string;
  readonly phoneHint: string;
  readonly phoneRequired: string;
  readonly sendCode: string;
  readonly otpLabel: string;
  readonly otpHint: string;
  readonly verify: string;
  readonly resend: string;
  readonly changePhone: string;
  readonly codeSent: string;
  readonly errorTitle: string;
  readonly invalidPhone: string;
  readonly invalidCode: string;
  readonly pinLabel: string;
  readonly pinHint: string;
  readonly pinConfirmLabel: string;
  readonly pinMismatch: string;
  readonly pinInvalid: string;
  readonly createAccount: string;
};

const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const CODE_PATTERN = /^[0-9]{6}$/;

async function requestCodeDefault(
  phone: string,
  locale: Locale,
  fallbackTitle: string,
): Promise<AuthOutcome<OtpChallenge>> {
  try {
    const response = await browserApi().POST('/v1/auth/otp-challenges', {
      body: { phone, locale },
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    });
    if (response.data !== undefined) {
      return { ok: true, value: response.data };
    }
    return {
      ok: false,
      problem: problemFrom(response.error, response.response, fallbackTitle),
    };
  } catch {
    return { ok: false, problem: { title: fallbackTitle } };
  }
}

async function verifyCodeDefault(
  challengeId: string,
  code: string,
  fallbackTitle: string,
): Promise<AuthOutcome<OtpVerification>> {
  try {
    const response = await browserApi().POST(
      '/v1/auth/otp-challenges/{challengeId}/verify',
      {
        params: { path: { challengeId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { code },
      },
    );
    if (response.data !== undefined) {
      return { ok: true, value: response.data };
    }
    return {
      ok: false,
      problem: problemFrom(response.error, response.response, fallbackTitle),
    };
  } catch {
    return { ok: false, problem: { title: fallbackTitle } };
  }
}

async function signupDefault(
  input: SignupInput,
  fallbackTitle: string,
): Promise<AuthOutcome<SessionSummary>> {
  try {
    const response = await browserApi().POST('/v1/auth/signups', {
      body: input,
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    });
    if (response.data !== undefined) {
      return { ok: true, value: response.data };
    }
    return {
      ok: false,
      problem: problemFrom(response.error, response.response, fallbackTitle),
    };
  } catch {
    return { ok: false, problem: { title: fallbackTitle } };
  }
}

export function PhoneOtpForm({
  labels,
  locale,
  requestCode,
  verifyCode,
  signup,
  onComplete,
}: {
  readonly labels: PhoneOtpLabels;
  readonly locale: Locale;
  readonly requestCode?: (phone: string) => Promise<AuthOutcome<OtpChallenge>>;
  readonly verifyCode?: (
    challengeId: string,
    code: string,
  ) => Promise<AuthOutcome<OtpVerification>>;
  readonly signup?: (input: SignupInput) => Promise<AuthOutcome<SessionSummary>>;
  readonly onComplete?: () => void;
}): ReactElement {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [verification, setVerification] = useState<OtpVerification | null>(
    null,
  );
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);

  async function submitPhone(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!PHONE_PATTERN.test(phone)) {
      setPhoneError(labels.invalidPhone);
      return;
    }
    setPhoneError(null);
    setProblem(null);
    setPending(true);
    const outcome =
      requestCode === undefined
        ? await requestCodeDefault(phone, locale, labels.errorTitle)
        : await requestCode(phone);
    if (outcome.ok) {
      setChallenge(outcome.value);
      setCode('');
    } else {
      setProblem(outcome.problem);
    }
    setPending(false);
  }

  async function submitCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (challenge === null) {
      return;
    }
    if (!CODE_PATTERN.test(code)) {
      setCodeError(labels.invalidCode);
      return;
    }
    setCodeError(null);
    setProblem(null);
    setPending(true);
    const outcome =
      verifyCode === undefined
        ? await verifyCodeDefault(
            challenge.challengeId,
            code,
            labels.errorTitle,
          )
        : await verifyCode(challenge.challengeId, code);
    if (outcome.ok) {
      setVerification(outcome.value);
      setCode('');
    } else {
      setProblem(outcome.problem);
    }
    setPending(false);
  }

  async function submitPin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (challenge === null || verification === null) {
      return;
    }
    if (!CODE_PATTERN.test(pin)) {
      setPinError(labels.pinInvalid);
      return;
    }
    if (pin !== pinConfirm) {
      setPinError(labels.pinMismatch);
      return;
    }
    setPinError(null);
    setProblem(null);
    setPending(true);
    const input: SignupInput = {
      phone,
      challengeId: challenge.challengeId,
      signupToken: verification.signupToken,
      pin,
      locale,
    };
    const outcome =
      signup === undefined
        ? await signupDefault(input, labels.errorTitle)
        : await signup(input);
    if (outcome.ok) {
      setPin('');
      setPinConfirm('');
      setVerification(null);
      if (onComplete === undefined) {
        window.location.assign('/objectifs');
      } else {
        onComplete();
      }
    } else {
      setProblem(outcome.problem);
    }
    setPending(false);
  }

  async function resendCode(): Promise<void> {
    setPending(true);
    setProblem(null);
    try {
      const outcome =
        requestCode === undefined
          ? await requestCodeDefault(phone, locale, labels.errorTitle)
          : await requestCode(phone);
      if (outcome.ok) {
        setChallenge(outcome.value);
        setCode('');
      } else {
        setProblem(outcome.problem);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="auth-panel" aria-labelledby="auth-title">
      <h1 id="auth-title" className="page-title">
        {labels.title}
      </h1>

      {problem === null ? null : <ErrorState problem={problem} />}

      {challenge === null ? (
        <form className="auth-form" onSubmit={(event) => void submitPhone(event)}>
          <TextField
            id="auth-phone"
            label={labels.phoneLabel}
            hint={labels.phoneHint}
            error={phoneError ?? undefined}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            name="phone"
            value={phone}
            onChange={(event) => setPhone(event.currentTarget.value)}
            required
          />
          <Button type="submit" block disabled={pending}>
            {labels.sendCode}
          </Button>
        </form>
      ) : null}

      {challenge !== null && verification === null ? (
        <form className="auth-form" onSubmit={(event) => void submitCode(event)}>
          <p className="auth-form__notice" role="status">
            {labels.codeSent}
          </p>
          <TextField
            id="auth-otp"
            label={labels.otpLabel}
            hint={labels.otpHint}
            error={codeError ?? undefined}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            pattern="[0-9]{6}"
            name="otp"
            value={code}
            onChange={(event) => setCode(event.currentTarget.value)}
            autoFocus
            required
          />
          <Button type="submit" block disabled={pending}>
            {labels.verify}
          </Button>
          <div className="auth-form__secondary">
            <button
              className="auth-form__link"
              type="button"
              onClick={() => {
                setChallenge(null);
                setCode('');
                setProblem(null);
              }}
            >
              {labels.changePhone}
            </button>
            <button
              className="auth-form__link"
              type="button"
              disabled={pending}
              onClick={() => void resendCode()}
            >
              {labels.resend}
            </button>
          </div>
        </form>
      ) : null}

      {verification === null ? null : (
        <form className="auth-form" onSubmit={(event) => void submitPin(event)}>
          <TextField
            id="auth-pin"
            label={labels.pinLabel}
            hint={labels.pinHint}
            error={
              pinError === labels.pinInvalid ? labels.pinInvalid : undefined
            }
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            pattern="[0-9]{6}"
            name="pin"
            value={pin}
            onChange={(event) => setPin(event.currentTarget.value)}
            autoFocus
            required
          />
          <TextField
            id="auth-pin-confirm"
            label={labels.pinConfirmLabel}
            error={
              pinError === labels.pinMismatch ? labels.pinMismatch : undefined
            }
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            pattern="[0-9]{6}"
            name="pin-confirm"
            value={pinConfirm}
            onChange={(event) => setPinConfirm(event.currentTarget.value)}
            required
          />
          <Button type="submit" block disabled={pending}>
            {labels.createAccount}
          </Button>
        </form>
      )}
    </section>
  );
}

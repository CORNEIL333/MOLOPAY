'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import type { FormEvent, ReactElement } from 'react';
import { useId, useRef, useState } from 'react';
import type { Dictionary, Locale } from '../i18n';
import type { AuthOutcome } from './phone-otp-form';

// Types de l'ancien brouillon (≤ 0.33.0), figés ici : connexion par téléphone + PIN, contraire à SEC-AUTH-001 (D71).
type SessionRequest = { phone: string; pin: string };
type SessionSummary = { accountId: string; displayName: string; locale: 'fr' | 'en'; expiresAt: string };

const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const PIN_PATTERN = /^[0-9]{6}$/;

/**
 * Contrat 0.34.0 : la connexion exige la clé de l'appareil puis le PIN (`device-challenges` → `sessions`) ; ce
 * formulaire « téléphone + PIN » n'envoie plus rien et s'affiche indisponible. Recâblage : lot G4 de Gemini.
 */
function loginDefault(_input: SessionRequest, fallbackTitle: string): Promise<AuthOutcome<SessionSummary>> {
  return Promise.resolve({ ok: false, problem: { title: fallbackTitle, status: 503 } });
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

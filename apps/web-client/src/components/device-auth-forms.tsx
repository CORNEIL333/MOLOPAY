'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import type { FormEvent, ReactElement } from 'react';
import { useId, useRef, useState } from 'react';
import type { Locale } from '../i18n';
import {
  completeSignup,
  loginWithDevice,
  requestSignupOtp,
  type ClientAuthOutcome,
  type ClientLoginResult,
  type OtpChallenge,
  type SignupRequest,
  type SignupResult,
} from '../lib/client-auth';
import { TERMS_VERSION } from '../lib/terms';

const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const SIX_DIGITS = /^[0-9]{6}$/;

export type DeviceSignupPorts = {
  readonly requestOtp?: (phone: string) => Promise<ClientAuthOutcome<OtpChallenge>>;
  readonly providePublicKey?: () => Promise<string>;
  readonly signup?: (input: SignupRequest) => Promise<ClientAuthOutcome<SignupResult>>;
};

export type DeviceLoginPorts = {
  readonly deviceId?: string;
  readonly signMessage?: (message: Uint8Array) => Promise<string>;
  readonly login?: (input: {
    readonly deviceId: string;
    readonly pin: string;
    readonly signMessage: (message: Uint8Array) => Promise<string>;
  }) => Promise<ClientAuthOutcome<ClientLoginResult>>;
};

/**
 * Contrat 0.34.0 / 0.35.0 (D71) : inscription OTP SMS → PIN + clé Ed25519 d'appareil.
 * Aucune simulation : si la route SMS renvoie 503 ou si la clé d'appareil est absente, l'état est affiché.
 */
export function DeviceSignupForm({
  locale,
  ports,
  onComplete,
}: {
  readonly locale: Locale;
  readonly ports?: DeviceSignupPorts;
  readonly onComplete?: (result: SignupResult) => void;
}): ReactElement {
  const id = useId();
  const isEn = locale === 'en';
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [deviceName, setDeviceName] = useState('Navigateur MoloPay');
  const [accepted, setAccepted] = useState(false);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  const errorTitle = isEn ? 'Sign-up unavailable' : 'Inscription impossible';

  async function submitPhone(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || submitting.current) return;
    setProblem(null);
    if (!PHONE_PATTERN.test(phone.trim())) {
      setFieldError(
        isEn
          ? 'Enter a valid international number (e.g. +237690000000).'
          : 'Saisissez un numéro international valide (ex. +237690000000).',
      );
      return;
    }
    setFieldError(null);
    submitting.current = true;
    setPending(true);
    try {
      const outcome = ports?.requestOtp !== undefined
        ? await ports.requestOtp(phone.trim())
        : await requestSignupOtp(phone.trim(), errorTitle);
      if (outcome.ok) setChallenge(outcome.value);
      else setProblem(outcome.problem);
    } catch {
      setProblem({ title: errorTitle });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  async function submitSignup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (challenge === null || pending || submitting.current) return;
    setProblem(null);
    if (!SIX_DIGITS.test(code) || !SIX_DIGITS.test(pin) || deviceName.trim().length === 0) {
      setFieldError(
        isEn
          ? 'Enter the 6-digit SMS code, a 6-digit PIN, and a device name.'
          : 'Saisissez le code SMS à 6 chiffres, un PIN à 6 chiffres et un nom d’appareil.',
      );
      return;
    }
    if (!accepted) {
      setFieldError(
        isEn ? 'You must accept the terms to continue.' : 'Vous devez accepter les conditions pour continuer.',
      );
      return;
    }
    if (ports?.providePublicKey === undefined) {
      setPin('');
      setFieldError(
        isEn
          ? 'Enrolling a device Ed25519 key requires the mobile application.'
          : 'L’enrôlement de la clé Ed25519 d’appareil exige l’application mobile.',
      );
      return;
    }

    setFieldError(null);
    submitting.current = true;
    setPending(true);
    try {
      const devicePublicKey = await ports.providePublicKey();
      const body: SignupRequest = {
        challengeId: challenge.challengeId,
        code,
        pin,
        devicePublicKey,
        deviceName: deviceName.trim(),
        acceptTermsVersion: TERMS_VERSION,
      };
      const outcome = ports.signup !== undefined
        ? await ports.signup(body)
        : await completeSignup(body, errorTitle);
      setPin('');
      if (outcome.ok) {
        if (onComplete === undefined) window.location.assign('/objectifs');
        else onComplete(outcome.value);
      } else {
        setProblem(outcome.problem);
      }
    } catch {
      setPin('');
      setProblem({ title: errorTitle });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <section className="auth-panel" aria-labelledby={`${id}-title`} aria-busy={pending}>
      <h1 id={`${id}-title`} className="page-title">
        {isEn ? 'Create an account' : 'Créer un compte'}
      </h1>
      {problem === null ? null : <ErrorState problem={problem} />}
      {fieldError === null ? null : <p role="alert">{fieldError}</p>}
      {challenge === null ? (
        <form className="auth-form" noValidate onSubmit={(e) => { void submitPhone(e); }}>
          <TextField
            id={`${id}-phone`}
            label={isEn ? 'Phone number' : 'Numéro de téléphone'}
            type="tel"
            value={phone}
            onChange={(e) => { setPhone(e.currentTarget.value); }}
            disabled={pending}
            required
          />
          <Button type="submit" block disabled={pending}>
            {isEn ? 'Send SMS code' : 'Recevoir un code SMS'}
          </Button>
        </form>
      ) : (
        <form className="auth-form" noValidate onSubmit={(e) => { void submitSignup(e); }}>
          <TextField
            id={`${id}-code`}
            label={isEn ? 'SMS code' : 'Code SMS'}
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => { setCode(e.currentTarget.value); }}
            disabled={pending}
            required
          />
          <TextField
            id={`${id}-pin`}
            label={isEn ? '6-digit PIN' : 'Code PIN à six chiffres'}
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => { setPin(e.currentTarget.value); }}
            disabled={pending}
            required
          />
          <TextField
            id={`${id}-device`}
            label={isEn ? 'Device name' : 'Nom de l’appareil'}
            value={deviceName}
            onChange={(e) => { setDeviceName(e.currentTarget.value); }}
            disabled={pending}
            required
          />
          <label htmlFor={`${id}-terms`}>
            <input
              id={`${id}-terms`}
              type="checkbox"
              checked={accepted}
              onChange={(e) => { setAccepted(e.currentTarget.checked); }}
              disabled={pending}
            />
            <span>
              {isEn ? 'I accept the terms of service.' : 'J’accepte les conditions générales.'}
            </span>
          </label>
          <Button type="submit" block disabled={pending}>
            {isEn ? 'Create my account' : 'Créer mon compte'}
          </Button>
        </form>
      )}
    </section>
  );
}

/**
 * Contrat 0.35.0 (D71 / SEC-AUTH-001) : connexion par défi appareil Ed25519 + PIN.
 * Sans clé d'appareil enrôlée dans ce navigateur, affiche honnêtement l'indisponibilité.
 */
export function DeviceLoginForm({
  locale,
  ports,
  onComplete,
}: {
  readonly locale: Locale;
  readonly ports?: DeviceLoginPorts;
  readonly onComplete?: (result: ClientLoginResult) => void;
}): ReactElement {
  const id = useId();
  const isEn = locale === 'en';
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  const errorTitle = isEn ? 'Sign-in unavailable' : 'Connexion impossible';
  const hasDeviceKey = ports?.deviceId !== undefined && ports.signMessage !== undefined;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || submitting.current || !hasDeviceKey) return;
    setProblem(null);
    if (!SIX_DIGITS.test(pin)) {
      setPinError(isEn ? 'Enter exactly six digits.' : 'Saisissez exactement six chiffres.');
      return;
    }
    setPinError(null);
    submitting.current = true;
    setPending(true);
    try {
      const payload = {
        deviceId: ports.deviceId,
        pin,
        signMessage: ports.signMessage,
      };
      const outcome = ports.login !== undefined
        ? await ports.login(payload)
        : await loginWithDevice(payload, errorTitle);
      setPin('');
      if (outcome.ok) {
        if (onComplete === undefined) window.location.assign('/objectifs');
        else onComplete(outcome.value);
      } else {
        setProblem(outcome.problem);
      }
    } catch {
      setPin('');
      setProblem({ title: errorTitle });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <section className="auth-panel" aria-labelledby={`${id}-title`} aria-busy={pending}>
      <h1 id={`${id}-title`} className="page-title">
        {isEn ? 'Sign in' : 'Connexion'}
      </h1>
      {problem === null ? null : <ErrorState problem={problem} />}
      {!hasDeviceKey ? (
        <p role="status">
          {isEn
            ? 'Client sign-in requires an enrolled device key (D71) and PIN.'
            : 'La connexion client exige une clé d’appareil enrôlée (D71) et votre code PIN.'}
        </p>
      ) : (
        <form className="auth-form" noValidate onSubmit={(e) => { void submit(e); }}>
          <TextField
            id={`${id}-pin`}
            label={isEn ? '6-digit PIN' : 'Code PIN à six chiffres'}
            error={pinError ?? undefined}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => { setPin(e.currentTarget.value); }}
            disabled={pending}
            required
          />
          <Button type="submit" block disabled={pending}>
            {isEn ? 'Sign in' : 'Se connecter'}
          </Button>
        </form>
      )}
    </section>
  );
}

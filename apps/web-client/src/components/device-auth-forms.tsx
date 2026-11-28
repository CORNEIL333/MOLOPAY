'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ChoiceChip, ErrorState, TextField } from '@achat/ui';
import type { FormEvent, ReactElement } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import type { Locale } from '../i18n';
import {
  completeSignup,
  loginWithDevice,
  requestSignupOtp,
  syncPreferredLanguage,
  type ClientAuthOutcome,
  type ClientLoginResult,
  type OtpChallenge,
  type SignupRequest,
  type SignupResult,
} from '../lib/client-auth';
import { TERMS_VERSION } from '../lib/terms';

const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const SIX_DIGITS = /^[0-9]{6}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRIVIAL_PINS = new Set(['123456', '654321', '000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999']);

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
  const [agencyMode, setAgencyMode] = useState(false);
  const [agencyChallengeId, setAgencyChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [deviceName, setDeviceName] = useState('Navigateur MoloPay');
  const [accepted, setAccepted] = useState(false);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('challengeId');
    if (q !== null && UUID_PATTERN.test(q)) { setAgencyChallengeId(q); setAgencyMode(true); }
  }, []);

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
    const resolvedChallengeId = agencyMode ? agencyChallengeId.trim() : (challenge?.challengeId ?? '');
    if ((!agencyMode && challenge === null) || pending || submitting.current) return;
    setProblem(null);
    if (agencyMode && !UUID_PATTERN.test(resolvedChallengeId)) {
      setFieldError(isEn ? 'Enter the valid agency enrollment ID.' : 'Saisissez l’identifiant valide du dossier d’agence.');
      return;
    }
    if (!SIX_DIGITS.test(code) || !SIX_DIGITS.test(pin) || deviceName.trim().length === 0) {
      setFieldError(
        isEn
          ? 'Enter the 6-digit code, a 6-digit PIN, and a device name.'
          : 'Saisissez le code à 6 chiffres, un PIN à 6 chiffres et un nom d’appareil.',
      );
      return;
    }
    if (TRIVIAL_PINS.has(pin)) {
      setFieldError(
        isEn
          ? 'This code is too easy to guess. Avoid 123456 or 111111.'
          : 'Ce code est trop facile à deviner. Évitez 123456 ou 111111.',
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
        challengeId: resolvedChallengeId,
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
        if (onComplete === undefined) {
          await syncPreferredLanguage(locale);
          window.location.assign('/objectifs');
        } else {
          onComplete(outcome.value);
        }
      } else {
        setProblem(outcome.problem);
      }
    } catch (error) {
      setPin('');
      setProblem(error instanceof Error && error.message === 'DEVICE_KEY_UNSUPPORTED'
        ? {
            title: errorTitle,
            detail: isEn
              ? 'This browser cannot create a secure device key. Use the mobile application or an up-to-date browser.'
              : 'Ce navigateur ne permet pas de créer une clé d’appareil sécurisée. Utilisez l’application mobile ou un navigateur à jour.',
          }
        : { title: errorTitle });
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
      <div className="mp-tabs">
        <ChoiceChip
          pressed={agencyMode}
          onClick={() => { setAgencyMode((prev) => !prev); setFieldError(null); setProblem(null); }}
        >
          {isEn ? 'I have a code from an agency' : 'J’ai un code donné en agence'}
        </ChoiceChip>
      </div>
      {agencyMode ? (
        <p className="mp-banner">
          {isEn
            ? 'A MoloPay agent checked your ID and gave you a 6-digit code. It is valid for 5 minutes.'
            : 'Un agent MoloPay a vérifié votre pièce d’identité et vous a donné un code à 6 chiffres. Il est valable 5 minutes.'}
        </p>
      ) : null}
      {problem === null ? null : <ErrorState problem={problem} />}
      {fieldError === null ? null : <p role="alert">{fieldError}</p>}
      {challenge === null && !agencyMode ? (
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
          {agencyMode ? (
            <TextField
              id={`${id}-agency-challenge`}
              label={isEn ? 'Agency enrollment ID' : 'Identifiant du dossier d’agence'}
              value={agencyChallengeId}
              onChange={(e) => { setAgencyChallengeId(e.currentTarget.value); }}
              disabled={pending}
              required
            />
          ) : null}
          <TextField
            id={`${id}-code`}
            label={agencyMode ? (isEn ? 'Code from agency' : 'Code remis en agence') : (isEn ? 'SMS code' : 'Code SMS')}
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
        if (onComplete === undefined) {
          await syncPreferredLanguage(locale);
          window.location.assign('/objectifs');
        } else {
          onComplete(outcome.value);
        }
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
            ? 'No device key is enrolled in this browser. Sign in from the device used to create your account, or create an account here.'
            : 'Aucune clé d’appareil n’est enrôlée dans ce navigateur. Connectez-vous depuis l’appareil utilisé à l’inscription, ou créez un compte ici.'}
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

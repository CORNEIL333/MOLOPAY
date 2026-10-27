import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { components } from '@achat/contracts/api';
import { expectNoA11yViolations } from '../../test/a11y';
import { getDictionary } from '../i18n';
import type { AuthOutcome, SignupInput } from './phone-otp-form';
import { PhoneOtpForm } from './phone-otp-form';

type OtpChallenge = components['schemas']['OtpChallenge'];
type OtpVerification = components['schemas']['OtpVerification'];
type SessionSummary = components['schemas']['SessionSummary'];

const labels = getDictionary('fr').auth;
const challenge: OtpChallenge = {
  challengeId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a70',
  expiresAt: '2026-10-26T20:10:00.000Z',
  resendAfterSeconds: 30,
};
const verification: OtpVerification = {
  challengeId: challenge.challengeId,
  signupToken: 'jeton fictif inscription de test 0123456789',
  expiresAt: '2026-10-26T20:05:00.000Z',
};
const session: SessionSummary = {
  accountId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a71',
  displayName: 'Client',
  locale: 'fr',
  expiresAt: '2026-10-27T20:00:00.000Z',
};

function renderForm(overrides: {
  requestCode?: (phone: string) => Promise<AuthOutcome<OtpChallenge>>;
  verifyCode?: (
    challengeId: string,
    code: string,
  ) => Promise<AuthOutcome<OtpVerification>>;
  signup?: (input: SignupInput) => Promise<AuthOutcome<SessionSummary>>;
  onComplete?: () => void;
}): ReturnType<typeof render> {
  return render(
    <PhoneOtpForm
      labels={labels}
      locale="fr"
      requestCode={
        overrides.requestCode ??
        (() => Promise.resolve({ ok: true as const, value: challenge }))
      }
      verifyCode={
        overrides.verifyCode ??
        (() => Promise.resolve({ ok: true as const, value: verification }))
      }
      signup={
        overrides.signup ??
        (() => Promise.resolve({ ok: true as const, value: session }))
      }
      {...(overrides.onComplete === undefined
        ? {}
        : { onComplete: overrides.onComplete })}
    />
  );
}

async function reachPinStep(): Promise<void> {
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText(labels.phoneLabel),
    '+237612345678',
  );
  await user.click(screen.getByRole('button', { name: labels.sendCode }));
  await user.type(screen.getByLabelText(labels.otpLabel), '123456');
  await user.click(screen.getByRole('button', { name: labels.verify }));
}

describe('PhoneOtpForm', () => {
  it('refuse un numéro invalide sans appeler le serveur', async () => {
    const user = userEvent.setup();
    const requestCode = vi.fn();
    renderForm({ requestCode });
    await user.type(screen.getByLabelText(labels.phoneLabel), '0612');
    await user.click(screen.getByRole('button', { name: labels.sendCode }));
    expect(requestCode).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(labels.invalidPhone);
  });

  it('enchaîne code puis PIN et ne divulgue jamais le jeton d’inscription', async () => {
    const user = userEvent.setup();
    const requestCode = vi.fn(
      (): Promise<AuthOutcome<OtpChallenge>> => Promise.resolve({
        ok: true,
        value: challenge,
      }),
    );
    const verifyCode = vi.fn(
      (): Promise<AuthOutcome<OtpVerification>> => Promise.resolve({
        ok: true,
        value: verification,
      }),
    );
    const signup = vi.fn(
      (): Promise<AuthOutcome<SessionSummary>> => Promise.resolve({
        ok: true,
        value: session,
      }),
    );
    const onComplete = vi.fn();
    const { container } = renderForm({
      requestCode,
      verifyCode,
      signup,
      onComplete,
    });

    await user.type(
      screen.getByLabelText(labels.phoneLabel),
      '+237612345678',
    );
    await user.click(screen.getByRole('button', { name: labels.sendCode }));
    expect(requestCode).toHaveBeenCalledWith('+237612345678');
    expect(screen.getByRole('status')).toHaveTextContent(labels.codeSent);

    await user.type(screen.getByLabelText(labels.otpLabel), '123456');
    await user.click(screen.getByRole('button', { name: labels.verify }));
    expect(verifyCode).toHaveBeenCalledWith(challenge.challengeId, '123456');

    await user.type(screen.getByLabelText(labels.pinLabel), '654321');
    await user.type(
      screen.getByLabelText(labels.pinConfirmLabel),
      '654321',
    );
    await user.click(
      screen.getByRole('button', { name: labels.createAccount }),
    );

    expect(signup).toHaveBeenCalledWith({
      phone: '+237612345678',
      challengeId: challenge.challengeId,
      signupToken: verification.signupToken,
      pin: '654321',
      locale: 'fr',
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(verification.signupToken);
    expect(container.innerHTML).not.toContain('654321');
  });

  it('bloque la création si les deux PIN diffèrent', async () => {
    const user = userEvent.setup();
    const signup = vi.fn();
    renderForm({ signup });
    await reachPinStep();
    await user.type(screen.getByLabelText(labels.pinLabel), '111111');
    await user.type(
      screen.getByLabelText(labels.pinConfirmLabel),
      '222222',
    );
    await user.click(
      screen.getByRole('button', { name: labels.createAccount }),
    );
    expect(signup).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(labels.pinMismatch);
  });

  it('affiche le refus du serveur sans exposer de détail interne', async () => {
    const user = userEvent.setup();
    renderForm({
      verifyCode: () => Promise.resolve({
        ok: false,
        problem: {
          title: 'Code incorrect',
          code: 'OTP_INVALID',
          status: 400,
        },
      }),
    });
    await user.type(
      screen.getByLabelText(labels.phoneLabel),
      '+237612345678',
    );
    await user.click(screen.getByRole('button', { name: labels.sendCode }));
    await user.type(screen.getByLabelText(labels.otpLabel), '000000');
    await user.click(screen.getByRole('button', { name: labels.verify }));
    expect(screen.getByRole('alert')).toHaveTextContent('Code incorrect');
    expect(screen.getByText('OTP_INVALID')).toBeVisible();
  });

  it('reste accessible à l’étape du PIN', async () => {
    const { container } = renderForm({});
    await reachPinStep();
    await expectNoA11yViolations(container);
  });
});

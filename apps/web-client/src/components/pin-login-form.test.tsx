import type { components } from '@achat/contracts/api';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { randomInt, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { getDictionary } from '../i18n';
import type { AuthOutcome } from './phone-otp-form';
import { PinLoginForm } from './pin-login-form';

type SessionRequest = components['schemas']['SessionRequest'];
type SessionSummary = components['schemas']['SessionSummary'];
type Login = (input: SessionRequest) => Promise<AuthOutcome<SessionSummary>>;

const labels = getDictionary('fr').auth;

function generatedInput(): SessionRequest {
  return {
    phone: `+999${Array.from({ length: 9 }, () => randomInt(0, 5)).join('')}`,
    pin: Array.from({ length: 6 }, () => randomInt(5, 10)).join(''),
  };
}

function generatedSession(): SessionSummary {
  return {
    accountId: randomUUID(),
    displayName: `Client-${randomUUID()}`,
    locale: 'fr',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

async function fillForm(input: SessionRequest): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(labels.phoneLabel), input.phone);
  if (input.pin !== '') {
    await user.type(screen.getByLabelText(labels.pinLabel), input.pin);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PinLoginForm', () => {
  it('golden : transmet les identifiants générés, termine et efface le PIN sans stockage', async () => {
    const input = generatedInput();
    const login = vi.fn<Login>(() => Promise.resolve({ ok: true, value: generatedSession() }));
    const onComplete = vi.fn();
    const store = vi.spyOn(Storage.prototype, 'setItem');
    const { container } = render(
      <PinLoginForm labels={labels} login={login} onComplete={onComplete} />,
    );
    expect(screen.getByRole('heading', { name: labels.loginTitle })).toBeVisible();
    expect(screen.getByText(labels.loginHint)).toBeVisible();
    expect(screen.getByRole('link', { name: labels.title })).toHaveAttribute('href', '/inscription');
    expect(screen.getByLabelText(labels.pinLabel)).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(labels.pinLabel)).toHaveAttribute('autocomplete', 'current-password');
    expect(container.querySelector('form')).toHaveAttribute('novalidate');

    await fillForm(input);
    await userEvent.click(screen.getByRole('button', { name: labels.loginButton }));

    expect(login).toHaveBeenCalledExactlyOnceWith(input);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(labels.pinLabel)).toHaveValue('');
    expect(container.innerHTML).not.toContain(input.pin);
    expect(store).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: labels.loginButton })).toBeEnabled();
  });

  it.each(['vide', 'court', 'long', 'lettres', 'chiffres non ASCII'])(
    'refuse un PIN %s sans appel',
    async (kind) => {
      const input = generatedInput();
      const invalidPins: Record<string, string> = {
        vide: '',
        court: input.pin.slice(0, 5),
        long: `${input.pin}${randomInt(0, 10)}`,
        lettres: `${input.pin.slice(0, 5)}a`,
        'chiffres non ASCII': '٠'.repeat(6),
      };
      const login = vi.fn<Login>();
      render(<PinLoginForm labels={labels} login={login} />);
      await fillForm({ ...input, pin: '' });
      fireEvent.change(screen.getByLabelText(labels.pinLabel), {
        target: { value: invalidPins[kind] },
      });
      await userEvent.click(screen.getByRole('button', { name: labels.loginButton }));

      expect(login).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').textContent).toBe(labels.pinInvalid);
      expect(screen.getByLabelText(labels.pinLabel)).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByLabelText(labels.pinLabel)).toHaveAccessibleDescription(labels.pinInvalid);
    },
  );

  it.each(['vide', 'sans plus', 'zéro initial', 'trop court', 'trop long', 'espaces'])(
    'refuse un téléphone %s sans appel',
    async (kind) => {
      const input = generatedInput();
      const invalidPhones: Record<string, string> = {
        vide: '',
        'sans plus': input.phone.slice(1),
        'zéro initial': `+0${input.phone.slice(2)}`,
        'trop court': input.phone.slice(0, 8),
        'trop long': `${input.phone}${input.phone.slice(1)}`,
        espaces: `${input.phone} `,
      };
      const login = vi.fn<Login>();
      render(<PinLoginForm labels={labels} login={login} />);
      fireEvent.change(screen.getByLabelText(labels.phoneLabel), {
        target: { value: invalidPhones[kind] },
      });
      await userEvent.type(screen.getByLabelText(labels.pinLabel), input.pin);
      await userEvent.click(screen.getByRole('button', { name: labels.loginButton }));

      expect(login).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').textContent).toBe(labels.invalidPhone);
      expect(screen.getByLabelText(labels.phoneLabel)).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByLabelText(labels.phoneLabel)).toHaveAccessibleDescription(
        `${labels.phoneHint} ${labels.invalidPhone}`,
      );
    },
  );

  it('affiche exactement le code de refus AUTH_INVALID_CREDENTIALS sans terminer', async () => {
    const login = vi.fn<Login>(() => Promise.resolve({
      ok: false,
      problem: { title: labels.errorTitle, code: 'AUTH_INVALID_CREDENTIALS', status: 401 },
    }));
    const onComplete = vi.fn();
    render(<PinLoginForm labels={labels} login={login} onComplete={onComplete} />);
    const input = generatedInput();
    await fillForm(input);
    await userEvent.click(screen.getByRole('button', { name: labels.loginButton }));

    expect(login).toHaveBeenCalledExactlyOnceWith(input);
    expect(screen.getByRole('alert')).toHaveTextContent(labels.errorTitle);
    expect(screen.getByText('AUTH_INVALID_CREDENTIALS', { exact: true })).toBeVisible();
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: labels.loginButton })).toBeEnabled();
  });

  it('masque le rejet réseau et libère pending pour une nouvelle tentative', async () => {
    const internalError = `internal-${randomUUID()}`;
    const login = vi.fn<Login>()
      .mockRejectedValueOnce(new Error(internalError))
      .mockResolvedValueOnce({ ok: true, value: generatedSession() });
    const onComplete = vi.fn();
    const { container } = render(
      <PinLoginForm labels={labels} login={login} onComplete={onComplete} />,
    );
    await fillForm(generatedInput());
    await userEvent.click(screen.getByRole('button', { name: labels.loginButton }));

    expect(screen.getByRole('alert').textContent).toBe(labels.errorTitle);
    expect(container.innerHTML).not.toContain(internalError);
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByLabelText(labels.phoneLabel)).toBeEnabled();
    expect(screen.getByLabelText(labels.pinLabel)).toBeEnabled();
    expect(screen.getByRole('button', { name: labels.loginButton })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: labels.loginButton }));
    expect(login).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('désactive les contrôles et refuse les doubles soumissions pendant pending', async () => {
    let complete: ((outcome: AuthOutcome<SessionSummary>) => void) | undefined;
    const response = new Promise<AuthOutcome<SessionSummary>>((resolve) => {
      complete = resolve;
    });
    const login = vi.fn<Login>(() => response);
    const onComplete = vi.fn();
    const { container } = render(
      <PinLoginForm labels={labels} login={login} onComplete={onComplete} />,
    );
    await fillForm(generatedInput());
    const form = container.querySelector('form');
    if (form === null) {
      throw new Error('Formulaire absent');
    }
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(screen.getByLabelText(labels.phoneLabel)).toBeDisabled();
    expect(screen.getByLabelText(labels.pinLabel)).toBeDisabled();
    expect(screen.getByRole('button', { name: labels.loginButton })).toBeDisabled();
    fireEvent.submit(form);
    expect(login).toHaveBeenCalledTimes(1);

    await act(async () => {
      complete?.({ ok: true, value: generatedSession() });
      await response;
    });
    await waitFor(() => expect(screen.getByRole('button', { name: labels.loginButton })).toBeEnabled());
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it.each(['fr', 'en'] as const)('reste accessible en %s, y compris les validations explicites', async (locale) => {
    const translated = getDictionary(locale).auth;
    const login = vi.fn<Login>();
    const { container } = render(<PinLoginForm labels={translated} locale={locale} login={login} />);
    expect(screen.getByRole('heading', { name: translated.loginTitle })).toBeVisible();
    await expectNoA11yViolations(container);

    await userEvent.click(screen.getByRole('button', { name: translated.loginButton }));
    expect(login).not.toHaveBeenCalled();
    expect(screen.getByText(translated.invalidPhone, { exact: true })).toBeVisible();
    expect(screen.getByText(translated.pinInvalid, { exact: true })).toBeVisible();
    await expectNoA11yViolations(container);
  });
});

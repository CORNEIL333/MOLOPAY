import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import {
  DeviceLoginForm,
  DeviceSignupForm,
  type DeviceLoginPorts,
  type DeviceSignupPorts,
} from './device-auth-forms';

describe('Contrat 0.34.0 / 0.35.0 — DeviceSignupForm et DeviceLoginForm', () => {
  it('DeviceSignupForm affiche SMS_UNCONFIGURED (503) sans simulation', async () => {
    const user = userEvent.setup();
    const requestOtp = vi.fn<NonNullable<DeviceSignupPorts['requestOtp']>>().mockResolvedValue({
      ok: false,
      problem: { title: 'SMS indisponible', status: 503, code: 'SMS_UNCONFIGURED' },
    });

    const { container } = render(
      <DeviceSignupForm locale="fr" ports={{ requestOtp }} />,
    );
    await user.type(screen.getByLabelText(/Numéro de téléphone/i), '+237690000000');
    await user.click(screen.getByRole('button', { name: /Recevoir un code SMS/i }));

    expect(await screen.findByText(/SMS_UNCONFIGURED/)).toBeInTheDocument();
    expect((await axe.run(container)).violations).toHaveLength(0);
  });

  it('DeviceLoginForm affiche l’indisponibilité sans clé d’appareil (zéro simulation)', async () => {
    const { container } = render(<DeviceLoginForm locale="fr" />);
    expect(screen.getByRole('status')).toHaveTextContent(/clé d’appareil enrôlée/i);
    expect((await axe.run(container)).violations).toHaveLength(0);
  });

  it('DeviceLoginForm exécute la connexion appareil + PIN et affiche IDENTITY_PIN_INVALID sur refus', async () => {
    const user = userEvent.setup();
    const signMessage = vi.fn<NonNullable<DeviceLoginPorts['signMessage']>>()
      .mockResolvedValue('c2ln');
    const login = vi.fn<NonNullable<DeviceLoginPorts['login']>>().mockResolvedValue({
      ok: false,
      problem: { title: 'PIN refusé', status: 422, code: 'IDENTITY_PIN_INVALID' },
    });

    render(
      <DeviceLoginForm
        locale="en"
        ports={{
          deviceId: '22222222-2222-4222-8222-222222222222',
          signMessage,
          login,
        }}
      />,
    );

    await user.type(screen.getByLabelText(/6-digit PIN/i), '739154');
    await user.click(screen.getByRole('button', { name: /Sign in/i }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/IDENTITY_PIN_INVALID/)).toBeInTheDocument();
  });
});

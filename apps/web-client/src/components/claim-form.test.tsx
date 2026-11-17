import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { ClaimForm, type ClaimPort } from './claim-form';

const RECEIPT = { claimId: '019ab700-0000-7000-8000-0000000000e1', reference: 'R-0123456789', status: 'OPEN' as const, createdAt: '2026-11-17T10:00:00.000Z' };

function port(result: Awaited<ReturnType<ClaimPort>> = { ok: true, receipt: RECEIPT }): ClaimPort {
  return vi.fn<ClaimPort>(() => Promise.resolve(result));
}

async function send(injected: ClaimPort, details: string, reason = 'PAYMENT_NOT_RECEIVED', locale: 'fr' | 'en' = 'fr'): Promise<void> {
  const user = userEvent.setup();
  render(<ClaimForm locale={locale} submit={injected} />);
  await user.selectOptions(screen.getByLabelText(locale === 'fr' ? 'Motif' : 'Reason'), reason);
  await user.type(screen.getByLabelText(locale === 'fr' ? 'Décrivez le problème' : 'Describe the problem'), details);
  await user.click(screen.getByRole('button', { name: locale === 'fr' ? 'Envoyer ma réclamation' : 'Send my claim' }));
}

describe('F-SUP-001 / D70 réclamation depuis la page d’un objectif', () => {
  it('motif et description envoyés ; accusé avec numéro et date', async () => {
    const injected = port();
    await send(injected, '  Mon versement du 3 novembre n’apparaît pas. ');
    await waitFor(() => { expect(screen.getByRole('status')).toHaveTextContent('R-0123456789'); });
    expect(injected).toHaveBeenCalledWith({ reason: 'PAYMENT_NOT_RECEIVED', details: 'Mon versement du 3 novembre n’apparaît pas.' });
  });

  it('description trop courte : aucun envoi', async () => {
    const injected = port();
    await send(injected, 'court');
    expect(screen.getByText(/10 caractères/)).toBeVisible();
    expect(injected).not.toHaveBeenCalled();
  });

  it('refus du serveur affiché (anglais)', async () => {
    await send(port({ ok: false, problem: { title: 'Not found', status: 404 } }), 'Nothing arrived for a week now.', 'OTHER', 'en');
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Not found'); });
  });

  it('rappel : ne jamais écrire de PIN ni de code', () => {
    render(<ClaimForm locale="fr" submit={port()} />);
    expect(screen.getByText(/N’indiquez jamais votre PIN/)).toBeVisible();
  });

  it('structure accessible', async () => {
    const { container } = render(<ClaimForm locale="fr" submit={port()} />);
    await expectNoA11yViolations(container);
  });
});

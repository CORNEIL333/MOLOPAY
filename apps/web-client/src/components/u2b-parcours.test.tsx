import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { getDictionary } from '../i18n';
import { goalFixture, offerFixture, quoteFixture } from '../test/fixtures';
import { DeviceSignupForm, type DeviceSignupPorts } from './device-auth-forms';
import { HandoverCodePanel, PayComingSoonPanel } from './goal-mvp-screens';
import { QuotePanel } from './quote-panel';
import { TermsAcceptance } from './terms-acceptance';

describe('MVP 0.0.1 · U2b parcours Web (D92 Verser bloqué, D69 Code de remise, C13 Agence, C11 CGU 5 points, Réservation 4 étapes)', () => {
  it('D92 · PayComingSoonPanel affiche l’état bloqué honnête sans aucun bouton de paiement', async () => {
    const goal = goalFixture({ offerTitle: 'Réfrigérateur 220 L', targetXaf: '250000', progressBasisPoints: 0 });
    const { container } = render(<PayComingSoonPanel goal={goal} locale="fr" />);
    expect(
      screen.getByText(/Les versements ouvriront bientôt\. Votre projet est réservé et votre prix est figé/),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.mp-glass')).toHaveLength(0);
    await expectNoA11yViolations(container);
  });

  it('D69 · HandoverCodePanel affiche le code de remise hors de tout verre ou l’indisponibilité honnête', async () => {
    const goal = goalFixture({ status: 'FUNDED', offerTitle: 'Réfrigérateur 220 L' });
    const { container, rerender } = render(
      <HandoverCodePanel
        goal={goal}
        handover={{ code: '849201', expiresAt: '2026-12-05T18:00:00Z', status: 'ACTIVE' }}
        locale="fr"
      />,
    );
    expect(screen.getByText(/C’est fait\. Votre Réfrigérateur 220 L vous attend\./)).toBeVisible();
    expect(screen.getByText('849201')).toBeVisible();
    expect(screen.getByText(/À présenter avec votre pièce d’identité/)).toBeVisible();
    expect(container.querySelectorAll('.mp-glass')).toHaveLength(0);
    await expectNoA11yViolations(container);

    rerender(<HandoverCodePanel goal={goalFixture({ status: 'ACTIVE' })} handover={null} locale="fr" />);
    expect(screen.getByText(/Le retrait n’est pas encore disponible/)).toBeVisible();
    expect(screen.queryByText('849201')).not.toBeInTheDocument();
  });

  it('C13 · DeviceSignupForm en mode code d’agence refuse un PIN trivial (123456) puis appelle signups sans SMS', async () => {
    const user = userEvent.setup();
    const requestOtp = vi.fn<NonNullable<DeviceSignupPorts['requestOtp']>>();
    const signup = vi.fn<NonNullable<DeviceSignupPorts['signup']>>().mockResolvedValue({
      ok: true,
      value: {
        accountId: '11111111-1111-4111-8111-111111111111',
        deviceId: '22222222-2222-4222-8222-222222222222',
        accessExpiresAt: '2026-12-01T00:00:00Z',
      },
    });
    const onComplete = vi.fn();

    const { container } = render(
      <DeviceSignupForm
        locale="fr"
        ports={{
          requestOtp,
          providePublicKey: () => Promise.resolve('MCowBQYDK2VwAyEAtest'),
          signup,
        }}
        onComplete={onComplete}
      />,
    );

    await user.click(screen.getByRole('button', { name: /J’ai un code donné en agence/i }));
    expect(screen.getByText(/valable 5 minutes/i)).toBeVisible();

    await user.type(screen.getByLabelText(/Identifiant du dossier d’agence/i), '33333333-3333-4333-8333-333333333333');
    await user.type(screen.getByLabelText(/Code remis en agence/i), '482910');
    await user.type(screen.getByLabelText(/Code PIN à six chiffres/i), '123456');
    await user.click(screen.getByRole('checkbox', { name: /conditions/i }));
    await user.click(screen.getByRole('button', { name: /Créer mon compte/i }));

    expect(signup).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/trop facile à deviner/i);
    await expectNoA11yViolations(container);

    const pinInput = screen.getByLabelText(/Code PIN à six chiffres/i);
    await user.clear(pinInput);
    await user.type(pinInput, '739184');
    await user.click(screen.getByRole('button', { name: /Créer mon compte/i }));

    await waitFor(() => {
      expect(signup).toHaveBeenCalledTimes(1);
    });
    expect(requestOtp).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('C11 · TermsAcceptance présente l’essentiel en 5 points, le bouton Écouter et un consentement marketing séparé non pré-coché', async () => {
    const { container } = render(<TermsAcceptance locale="fr" version="2026-10-26-v1" />);
    expect(screen.getByText(/L’essentiel en 5 points/)).toBeVisible();
    expect(screen.getByText(/0 FCFA de frais pour épargner/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Écouter' })).toBeVisible();
    const marketing = screen.getByRole('switch', { name: /Messages d’offres \(facultatif\)/ });
    expect(marketing).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await expectNoA11yViolations(container);
  });

  it('Réservation 4 étapes · QuotePanel enchaîne lieu de retrait, rythme souple et relecture d’accord avec clauses de sortie', async () => {
    const user = userEvent.setup();
    const fr = getDictionary('fr');
    const { container } = render(
      <QuotePanel
        offer={offerFixture()}
        plans={[{ planId: 'plan-a', model: 'SAVE_THEN_BUY', rhythm: 'MONTHLY', minAmountXaf: '5000', maxDurationMonths: 12 }]}
        labels={{ ...fr.offer, models: fr.catalog.models }}
        locale="fr"
        requestQuote={() => Promise.resolve({ ok: true, quote: quoteFixture() })}
      />,
    );
    expect(screen.getByText(/Où le récupérer/)).toBeVisible();
    expect(screen.getByText(/seul le total compte/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: fr.offer.requestQuote }));
    expect(await screen.findByText(/Relire l’accord/)).toBeVisible();
    expect(screen.getByText(/remboursé à 100 %, sans frais/)).toBeVisible();
    expect(screen.getByText(/Glissez pour signer/)).toBeVisible();
    await expectNoA11yViolations(container);
  });
});
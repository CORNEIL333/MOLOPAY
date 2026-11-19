import type { components } from '@achat/contracts/api';
import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { AccountProfileCard } from './account-profile-card';

type Account = components['schemas']['Account'];

describe('C2 / D77 — AccountProfileCard (GET /v1/me minimal, sans niveau KYC)', () => {
  it('affiche le numéro masqué, la date d’adhésion et l’état de déclaration du nom légal', async () => {
    const account: Account = {
      accountId: '22222222-2222-4222-8222-222222222222',
      phoneMasked: '+2376•••••••34',
      memberSince: '2026-10-26',
      legalNameDeclared: true,
    };
    const { container } = render(<AccountProfileCard account={account} locale="fr" />);

    expect(screen.getByText('+2376•••••••34')).toBeInTheDocument();
    expect(screen.getByText(/Nom légal déclaré/i)).toBeInTheDocument();
    expect(screen.queryByText(/KYC|BASIC|VERIFIED|SANCTIONS/i)).not.toBeInTheDocument();
    expect((await axe.run(container)).violations).toHaveLength(0);
  });

  it('propose de déclarer son nom légal en anglais quand non encore déclaré', async () => {
    const account: Account = {
      accountId: '22222222-2222-4222-8222-222222222222',
      phoneMasked: '+2376•••••••34',
      memberSince: '2026-10-26',
      legalNameDeclared: false,
    };
    const { container } = render(<AccountProfileCard account={account} locale="en" />);

    expect(screen.getByRole('link', { name: /Declare your legal name/i })).toHaveAttribute(
      'href',
      '/compte/identite',
    );
    expect((await axe.run(container)).violations).toHaveLength(0);
  });
});

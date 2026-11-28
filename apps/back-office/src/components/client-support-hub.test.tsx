import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { ClientSupportHub } from './client-support-hub';

describe('09_… § 4.3 · Pôle Clients, support et état honnête de la fiche CRM 360°', () => {
  it('relie tous les outils clients existants et affiche l’état honnête sans simulation de la fiche 360° (FR/EN)', async () => {
    const { container, rerender } = render(<ClientSupportHub locale="fr" />);
    expect(container.querySelector('.mp-glass')).toBeNull();
    expect(container.querySelector('.mp-liquid')).toBeNull();
    expect(screen.getByRole('link', { name: /Réclamations/i })).toHaveAttribute('href', '/reclamations');
    expect(screen.getByRole('link', { name: /Historique d’un objectif/i })).toHaveAttribute('href', '/objectifs');
    expect(screen.getByRole('link', { name: /Déclaration de décès/i })).toHaveAttribute('href', '/clients/deces');
    expect(screen.getByText(/Aucune route CRM n’est simulée/i)).toBeVisible();
    await expectNoA11yViolations(container);

    rerender(<ClientSupportHub locale="en" />);
    expect(screen.getByRole('heading', { level: 1, name: /Customers and support/i })).toBeVisible();
    await expectNoA11yViolations(container);
  });
});

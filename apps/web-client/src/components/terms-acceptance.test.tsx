import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { TermsAcceptance } from './terms-acceptance';

describe('F-ACC-004 acceptation des conditions en vigueur', () => {
  it('case à cocher obligatoire, puis appel unique et confirmation', async () => {
    const user = userEvent.setup();
    const accept = vi.fn(() => Promise.resolve({ ok: true as const }));
    const onAccepted = vi.fn();
    const { container } = render(<TermsAcceptance locale="fr" version="2026-10-26-v1" accept={accept} onAccepted={onAccepted} />);
    expect((await axe.run(container)).violations).toHaveLength(0);
    const button = screen.getByRole('button', { name: 'Accepter' });
    expect(button).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /J’ai lu et j’accepte/ }));
    await user.click(button);
    await waitFor(() => { expect(onAccepted).toHaveBeenCalledOnce(); });
    expect(accept).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Conditions acceptées (version 2026-10-26-v1)');
  });

  it('refus du serveur affiché, la case reste cochée pour réessayer', async () => {
    const user = userEvent.setup();
    const accept = vi.fn(() => Promise.resolve({ ok: false as const, problem: { title: 'Requête invalide', detail: 'version des conditions non courante', status: 400 } }));
    render(<TermsAcceptance locale="fr" version="2026-10-26-v1" accept={accept} onAccepted={vi.fn()} />);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Accepter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('version des conditions non courante');
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
});

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { components } from '@achat/contracts/api';
import { DataRightsView } from './data-rights';
import { expectNoA11yViolations } from '../../test/a11y';
const history: components['schemas']['DataRightHistory'] = { asOf: '2026-11-06T10:00:00Z', nextBefore: null,
  items: [{ requestId: '019a9600-0000-7000-8000-000000000001', kind: 'ERASURE', status: 'RECEIVED', receivedAt: '2026-11-05T10:00:00Z' }] };
describe('F-ACC-005 · espace des demandes de droits', () => {
  it('affiche les reçus sans annoncer un effacement réalisé', () => {
    render(<DataRightsView history={history} locale="fr" />);
    expect(screen.getByRole('heading', { name: 'Mes données personnelles' })).toBeVisible();
    expect(screen.getByText('Demande enregistrée')).toBeVisible();
    expect(screen.getByText(/ne réalise ni export, ni modification, ni suppression/)).toBeVisible();
    expect(screen.getByText(history.items[0]!.requestId)).toBeVisible();
  });
  it('confirme le type choisi et permet une annulation sans requête', async () => {
    const user = userEvent.setup();
    render(<DataRightsView history={history} locale="fr" />);
    await user.selectOptions(screen.getByLabelText('Type de demande'), 'RECTIFICATION');
    const trigger = screen.getByRole('button', { name: 'Préparer ma demande' });
    await user.click(trigger);
    expect(screen.getByRole('heading', { name: 'Confirmer ma demande' })).toHaveFocus();
    expect(screen.getByText(/Rectification/, { selector: 'strong' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('button', { name: 'Enregistrer la demande' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
  it('désactive les écritures hors ligne et offre la page suivante', () => {
    render(<DataRightsView history={{ ...history, nextBefore: history.items[0]!.requestId }} locale="fr" />);
    expect(screen.getByRole('link', { name: 'Demandes plus anciennes' })).toHaveAttribute('href', `/compte/donnees?before=${history.items[0]!.requestId}`);
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(screen.getByRole('button', { name: 'Préparer ma demande' })).toBeDisabled();
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(screen.getByRole('button', { name: 'Préparer ma demande' })).toBeEnabled();
  });
  it('propose les quatre droits en anglais avec une structure accessible', async () => {
    const { container } = render(<DataRightsView history={{ ...history, items: [] }} locale="en" />);
    expect(screen.getByRole('heading', { name: 'My personal data' })).toBeVisible();
    expect(screen.getByLabelText('Request type').querySelectorAll('option')).toHaveLength(4);
    expect(screen.getByText('No requests recorded.')).toBeVisible();
    await expectNoA11yViolations(container);
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { AgencyEnrollment, type AgencyEnrollmentPorts } from './agency-enrollment';

const ISSUED = { challengeId: '019ab900-0000-7000-8000-0000000000c9', expiresAt: '2026-11-24T10:05:00.000Z', code: '482910' };

describe('C13 / F-ACC-001 inscription en agence au back-office', () => {
  it('vérification en personne confirmée obligatoire ; code affiché une fois, puis client suivant', async () => {
    const user = userEvent.setup();
    const issue = vi.fn<AgencyEnrollmentPorts['issue']>(() => Promise.resolve({ ok: true, enrollment: ISSUED }));
    render(<AgencyEnrollment ports={{ issue }} />);
    await user.clear(screen.getByLabelText('Téléphone du client'));
    await user.type(screen.getByLabelText('Téléphone du client'), '+237 690 123 456');
    await user.selectOptions(screen.getByLabelText('Pièce présentée'), 'PASSPORT');
    await user.click(screen.getByRole('button', { name: 'Émettre le code' }));
    expect(screen.getByText(/Confirmez avoir vérifié la pièce/)).toBeVisible();
    expect(issue).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText(/J’ai vérifié la pièce et le téléphone/));
    await user.click(screen.getByRole('button', { name: 'Émettre le code' }));
    await waitFor(() => { expect(issue).toHaveBeenCalledWith({ phone: '+237690123456', documentType: 'PASSPORT', cityId: 'douala' }); });
    expect(screen.getByRole('status')).toHaveTextContent('482910');
    await expectNoA11yViolations(document.body);
    await user.click(screen.getByRole('button', { name: 'Client suivant' }));
    expect(screen.queryByText('482910')).toBeNull();
    expect(screen.getByLabelText(/J’ai vérifié/)).not.toBeChecked();
  });

  it('numéro invalide refusé avant envoi ; refus du serveur affiché ; rejeu sans code', async () => {
    const user = userEvent.setup();
    const issue = vi.fn<AgencyEnrollmentPorts['issue']>()
      .mockResolvedValueOnce({ ok: false, problem: { title: 'Conflit', detail: 'Un compte existe déjà pour ce numéro', status: 409 } })
      .mockResolvedValueOnce({ ok: true, enrollment: { ...ISSUED, code: null } });
    render(<AgencyEnrollment ports={{ issue }} />);
    await user.click(screen.getByLabelText(/J’ai vérifié/));
    await user.click(screen.getByRole('button', { name: 'Émettre le code' }));
    expect(screen.getByText(/Numéro international attendu/)).toBeVisible();
    await user.type(screen.getByLabelText('Téléphone du client'), '690123456');
    await user.click(screen.getByRole('button', { name: 'Émettre le code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Un compte existe déjà');
    await user.click(screen.getByRole('button', { name: 'Émettre le code' }));
    expect(await screen.findByText(/Ce code a déjà été affiché/)).toBeVisible();
  });
});

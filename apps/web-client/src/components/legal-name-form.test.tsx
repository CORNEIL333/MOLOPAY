import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { LegalNameForm, type LegalNamePort } from './legal-name-form';

function port(result: Awaited<ReturnType<LegalNamePort>>): LegalNamePort {
  return vi.fn<LegalNamePort>(() => Promise.resolve(result));
}

async function submit(injected: LegalNamePort, name: string, locale: 'fr' | 'en' = 'fr'): Promise<void> {
  const user = userEvent.setup();
  render(<LegalNameForm locale={locale} submit={injected} />);
  await user.type(screen.getByLabelText(locale === 'fr' ? 'Nom complet (tel qu’inscrit sur votre pièce d’identité)' : 'Full name (as on your ID document)'), name);
  await user.click(screen.getByRole('button', { name: locale === 'fr' ? 'Enregistrer mon nom' : 'Save my name' }));
}

describe('REG-LBC-001 / D68 déclaration du nom légal (client web)', () => {
  it('nom valide : envoyé une fois, niveau 1 confirmé', async () => {
    const injected = port({ ok: true, kycLevel: 'BASIC', verification: 'COMPLETED' });
    await submit(injected, '  Aïcha   Ngono Mballa ');
    await waitFor(() => { expect(screen.getByRole('status')).toHaveTextContent('Votre nom est enregistré'); });
    expect(injected).toHaveBeenCalledTimes(1);
    expect(injected).toHaveBeenCalledWith('Aïcha Ngono Mballa');
  });

  it('vérification en cours : message neutre, jamais de détail', async () => {
    await submit(port({ ok: true, kycLevel: 'NONE', verification: 'IN_PROGRESS' }), 'Eric Badege');
    await waitFor(() => { expect(screen.getByRole('status')).toHaveTextContent('vérification est en cours'); });
    expect(document.body).not.toHaveTextContent(/sanction|ONU|liste|correspond/i);
  });

  it('nom trop court : aucun envoi', async () => {
    const injected = port({ ok: true, kycLevel: 'BASIC', verification: 'COMPLETED' });
    await submit(injected, 'A');
    expect(screen.getByText(/au moins 2 caractères/)).toBeVisible();
    expect(injected).not.toHaveBeenCalled();
  });

  it('refus du serveur affiché ; anglais disponible', async () => {
    await submit(port({ ok: false, problem: { title: 'Request not completed', status: 422 } }), 'Paul Atangana', 'en');
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Request not completed'); });
  });

  it('structure accessible', async () => {
    const { container } = render(<LegalNameForm locale="fr" submit={port({ ok: true, kycLevel: 'BASIC', verification: 'COMPLETED' })} />);
    await expectNoA11yViolations(container);
  });
});

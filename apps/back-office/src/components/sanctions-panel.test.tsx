import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { SanctionsPanel, type SanctionsPorts } from './sanctions-panel';

const SCREENING = { screeningId: '019ab400-0000-7000-8000-000000000001', partnerId: 'merchant-9', versionId: '019ab400-0000-7000-8000-000000000002', outcome: 'POTENTIAL_MATCH' as const, matchedReferences: ['CDe.002'] };

function ports(overrides: Partial<SanctionsPorts> = {}): SanctionsPorts {
  return {
    screen: vi.fn<SanctionsPorts['screen']>(() => Promise.resolve({ ok: true, screening: SCREENING })),
    review: vi.fn<SanctionsPorts['review']>(() => Promise.resolve({ ok: true, status: 'RECORDED' })),
    detail: vi.fn<SanctionsPorts['detail']>(() =>
      Promise.resolve({
        ok: true,
        detail: {
          screeningId: SCREENING.screeningId, subjectType: 'PARTNER', subjectId: 'merchant-9', normalizedName: 'BUTEMBO AIRLINES SARL', outcome: 'POTENTIAL_MATCH',
          screenedAt: '2026-11-17T10:00:00.000Z', review: null,
          matches: [{ reference: 'CDe.002', kind: 'ENTITY', names: ['BUTEMBO AIRLINES (BAL)'], listedOn: '2007-03-29' }],
        },
      }),
    ),
    ...overrides,
  };
}

async function screenPartner(injected: SanctionsPorts, partnerId = 'merchant-9'): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<SanctionsPanel ports={injected} />);
  await user.type(screen.getByLabelText('Identifiant du partenaire'), partnerId);
  await user.click(screen.getByRole('button', { name: 'Filtrer contre la liste ONU' }));
  return user;
}

describe('REG-LBC-002 / D66 filtrage sanctions au back-office', () => {
  it('identifiant invalide : aucun appel', async () => {
    const injected = ports();
    await screenPartner(injected, 'mauvais id!');
    expect(screen.getByText(/Identifiant invalide/)).toBeVisible();
    expect(injected.screen).not.toHaveBeenCalled();
  });

  it('aucun rapprochement : résultat affiché, pas de formulaire d’examen', async () => {
    await screenPartner(ports({ screen: () => Promise.resolve({ ok: true, screening: { ...SCREENING, outcome: 'CLEAR', matchedReferences: [] } }) }));
    expect(await screen.findByRole('status')).toHaveTextContent('Aucun rapprochement');
    expect(screen.queryByRole('button', { name: 'Enregistrer l’examen' })).toBeNull();
  });

  it('rapprochement : références listées, examen motivé obligatoire puis enregistré', async () => {
    const injected = ports();
    const user = await screenPartner(injected);
    expect(await screen.findByRole('status')).toHaveTextContent('Rapprochement possible : CDe.002');
    expect(injected.screen).toHaveBeenCalledWith('merchant-9');
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’examen' }));
    expect(screen.getByText(/motif est obligatoire/)).toBeVisible();
    expect(injected.review).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Décision'), 'CONFIRMED_MATCH');
    await user.type(screen.getByLabelText('Motif de l’examen'), 'correspondance avérée');
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’examen' }));
    await waitFor(() => { expect(injected.review).toHaveBeenCalledWith(SCREENING.screeningId, 'CONFIRMED_MATCH', 'correspondance avérée'); });
    expect(await screen.findByText('Examen enregistré.')).toBeVisible();
  });

  it('D74 détail avant examen : motif de consultation exigé, nom filtré et noms listés affichés', async () => {
    const injected = ports();
    const user = await screenPartner(injected);
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: 'Voir le détail' }));
    expect(screen.getByText(/motif de consultation est obligatoire/)).toBeVisible();
    expect(injected.detail).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Motif de la consultation'), 'examen du rapprochement');
    await user.click(screen.getByRole('button', { name: 'Voir le détail' }));
    await waitFor(() => { expect(injected.detail).toHaveBeenCalledWith(SCREENING.screeningId, 'examen du rapprochement'); });
    const region = await screen.findByRole('region', { name: 'Détail du filtrage' });
    expect(region).toHaveTextContent('BUTEMBO AIRLINES SARL');
    expect(region).toHaveTextContent('CDe.002');
    expect(region).toHaveTextContent('BUTEMBO AIRLINES (BAL)');
    expect(region).toHaveTextContent('2007-03-29');
  });

  it('D75 filtrage existant (depuis la file) : ouvert par identifiant et motif, détail puis examen', async () => {
    const injected = ports();
    const user = userEvent.setup();
    render(<SanctionsPanel ports={injected} />);
    await user.type(screen.getByLabelText('Identifiant du filtrage'), SCREENING.screeningId);
    await user.type(screen.getByLabelText('Motif de la consultation'), 'examen de la file');
    await user.click(screen.getByRole('button', { name: 'Ouvrir le filtrage' }));
    await waitFor(() => { expect(injected.detail).toHaveBeenCalledWith(SCREENING.screeningId, 'examen de la file'); });
    expect(await screen.findByRole('region', { name: 'Détail du filtrage' })).toHaveTextContent('BUTEMBO AIRLINES SARL');
    await user.type(screen.getByLabelText('Motif de l’examen'), 'société distincte');
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’examen' }));
    await waitFor(() => { expect(injected.review).toHaveBeenCalledWith(SCREENING.screeningId, 'FALSE_POSITIVE', 'société distincte'); });
    expect(injected.screen).not.toHaveBeenCalled();
  });

  it('I-4 faux positif client : proposition enregistrée, confirmation par une autre personne annoncée, formulaire retiré', async () => {
    const injected = ports({ review: vi.fn<SanctionsPorts['review']>(() => Promise.resolve({ ok: true, status: 'PROPOSED' })) });
    const user = userEvent.setup();
    render(<SanctionsPanel ports={injected} />);
    await user.type(screen.getByLabelText('Identifiant du filtrage'), SCREENING.screeningId);
    await user.type(screen.getByLabelText('Motif de la consultation'), 'examen de la file');
    await user.click(screen.getByRole('button', { name: 'Ouvrir le filtrage' }));
    await user.type(await screen.findByLabelText('Motif de l’examen'), 'homonyme, date de naissance différente');
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’examen' }));
    expect(await screen.findByText(/Une autre personne de la Conformité doit la confirmer/)).toBeVisible();
    expect(screen.queryByText('Examen enregistré.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enregistrer l’examen' })).toBeNull();
  });

  it('identifiant de filtrage invalide : aucun appel', async () => {
    const injected = ports();
    const user = userEvent.setup();
    render(<SanctionsPanel ports={injected} />);
    await user.type(screen.getByLabelText('Identifiant du filtrage'), 'pas-un-uuid');
    await user.type(screen.getByLabelText('Motif de la consultation'), 'examen de la file');
    await user.click(screen.getByRole('button', { name: 'Ouvrir le filtrage' }));
    expect(screen.getByText(/Identifiant de filtrage invalide/)).toBeVisible();
    expect(injected.detail).not.toHaveBeenCalled();
  });

  it('filtrage existant : motif de consultation obligatoire ; déjà examiné → aucun formulaire d’examen', async () => {
    const reviewed = vi.fn<SanctionsPorts['detail']>(() =>
      Promise.resolve({
        ok: true,
        detail: {
          screeningId: SCREENING.screeningId, subjectType: 'CUSTOMER', subjectId: 'client', normalizedName: 'ERIC BADEGE', outcome: 'POTENTIAL_MATCH',
          screenedAt: '2026-11-17T10:00:00.000Z', review: { decision: 'FALSE_POSITIVE', reviewedAt: '2026-11-17T11:00:00.000Z' },
          matches: [{ reference: 'CDi.001', kind: 'INDIVIDUAL', names: ['ERIC BADEGE'], listedOn: '2012-12-31' }],
        },
      }),
    );
    const injected = ports({ detail: reviewed });
    const user = userEvent.setup();
    render(<SanctionsPanel ports={injected} />);
    await user.type(screen.getByLabelText('Identifiant du filtrage'), SCREENING.screeningId);
    await user.click(screen.getByRole('button', { name: 'Ouvrir le filtrage' }));
    expect(screen.getByText(/motif de consultation est obligatoire/)).toBeVisible();
    expect(reviewed).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Motif de la consultation'), 'contrôle');
    await user.click(screen.getByRole('button', { name: 'Ouvrir le filtrage' }));
    await screen.findByRole('region', { name: 'Détail du filtrage' });
    expect(screen.queryByRole('button', { name: 'Enregistrer l’examen' })).toBeNull();
  });

  it('refus du serveur (auteur du filtrage) : problème affiché', async () => {
    const user = await screenPartner(ports({ review: () => Promise.resolve({ ok: false, problem: { title: 'Action interdite', detail: 'l’auteur du filtrage ne peut pas l’examiner', status: 403 } }) }));
    await screen.findByRole('status');
    await user.type(screen.getByLabelText('Motif de l’examen'), 'homonyme');
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’examen' }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('l’auteur du filtrage'); });
  });

  it('structure accessible', async () => {
    await screenPartner(ports());
    await screen.findByRole('status');
    await expectNoA11yViolations(document.body);
  });

  it('identifiant prérempli depuis la file (paramètre d’URL)', () => {
    render(<SanctionsPanel ports={ports()} initialScreeningId="019aa800-0000-7000-8000-0000000000e1" />);
    expect(screen.getByLabelText('Identifiant du filtrage')).toHaveValue('019aa800-0000-7000-8000-0000000000e1');
  });
});

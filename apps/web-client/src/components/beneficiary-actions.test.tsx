import { createHash } from 'node:crypto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { goalFixture } from '../test/fixtures';
import { BeneficiaryActions, type BeneficiaryPorts } from './beneficiary-actions';

const FUNDED_C = goalFixture({
  model: 'PLANNED_EXPENSE',
  offerId: null,
  offerTitle: null,
  partnerName: null,
  beneficiaryId: 'landlord-1',
  status: 'FUNDED',
  savedXaf: '260000',
  progressBasisPoints: 10000,
});

const RECEIPT = {
  goalId: FUNDED_C.goalId,
  payoutId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a99',
  beneficiaryId: 'landlord-1',
  amountXaf: '260000',
  executedAt: '2026-11-11T10:00:00.000Z',
  bankReference: 'ETAB-VIR-77',
  entryHashPrefix: '0a1b2c3d',
};

function ports(overrides: Partial<BeneficiaryPorts> = {}): BeneficiaryPorts {
  return {
    submitDocument: vi.fn<BeneficiaryPorts['submitDocument']>(() => Promise.resolve({ ok: true })),
    payBeneficiary: vi.fn<BeneficiaryPorts['payBeneficiary']>(() => Promise.resolve({ ok: true })),
    ...overrides,
  };
}

describe('F-PLN-002/003 actions du client sur le bénéficiaire (modèle C)', () => {
  it('n’affiche rien pour un objectif A', () => {
    const { container } = render(<BeneficiaryActions goal={goalFixture()} receipt={null} locale="fr" ports={ports()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('dépose seulement l’empreinte SHA-256 du fichier, calculée dans le navigateur', async () => {
    const user = userEvent.setup();
    const injected = ports();
    render(<BeneficiaryActions goal={FUNDED_C} receipt={null} locale="fr" ports={injected} />);
    const content = 'bail signé — contenu de test';
    await user.upload(screen.getByLabelText('Fichier'), new File([content], 'bail.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'Déposer la pièce' }));
    await waitFor(() => { expect(screen.getByText('Pièce déposée, en attente de vérification.')).toBeVisible(); });
    expect(injected.submitDocument).toHaveBeenCalledWith({
      kind: 'LEASE',
      sha256: createHash('sha256').update(content).digest('hex'),
    });
    expect(JSON.stringify(vi.mocked(injected.submitDocument).mock.calls)).not.toContain('bail.pdf');
  });

  it('refuse un dépôt sans fichier, sans appel serveur', async () => {
    const user = userEvent.setup();
    const injected = ports();
    render(<BeneficiaryActions goal={FUNDED_C} receipt={null} locale="fr" ports={injected} />);
    await user.click(screen.getByRole('button', { name: 'Déposer la pièce' }));
    expect(screen.getByText('Choisissez un fichier.')).toBeVisible();
    expect(injected.submitDocument).not.toHaveBeenCalled();
  });

  it('règle le bénéficiaire avec un PIN à 6 chiffres ; refuse un PIN invalide sans appel', async () => {
    const user = userEvent.setup();
    const injected = ports();
    render(<BeneficiaryActions goal={FUNDED_C} receipt={null} locale="fr" ports={injected} />);
    await user.type(screen.getByLabelText('PIN (6 chiffres)'), '12a');
    await user.click(screen.getByRole('button', { name: 'Confirmer le règlement' }));
    expect(screen.getByText('Le PIN comporte 6 chiffres.')).toBeVisible();
    expect(injected.payBeneficiary).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('PIN (6 chiffres)'));
    await user.type(screen.getByLabelText('PIN (6 chiffres)'), '284917');
    await user.click(screen.getByRole('button', { name: 'Confirmer le règlement' }));
    await waitFor(() => { expect(screen.getByText('Règlement confirmé.')).toBeVisible(); });
    expect(injected.payBeneficiary).toHaveBeenCalledWith('284917');
    expect(screen.getByLabelText('PIN (6 chiffres)')).toHaveValue('');
  });

  it('affiche le problème renvoyé par le serveur (pièce non validée)', async () => {
    const user = userEvent.setup();
    const injected = ports({
      payBeneficiary: vi.fn<BeneficiaryPorts['payBeneficiary']>(() =>
        Promise.resolve({ ok: false, problem: { title: 'Règle métier non respectée', detail: 'pièce du bénéficiaire non validée par la conformité' } }),
      ),
    });
    render(<BeneficiaryActions goal={FUNDED_C} receipt={null} locale="fr" ports={injected} />);
    await user.type(screen.getByLabelText('PIN (6 chiffres)'), '284917');
    await user.click(screen.getByRole('button', { name: 'Confirmer le règlement' }));
    await waitFor(() => { expect(screen.getByText(/pièce du bénéficiaire non validée/)).toBeVisible(); });
  });

  it('objectif réglé : reçu affiché, ou exécution en cours si pas encore de reçu', async () => {
    const paid = { ...FUNDED_C, status: 'PAID_TO_BENEFICIARY' as const };
    const { rerender, container } = render(<BeneficiaryActions goal={paid} receipt={RECEIPT} locale="fr" ports={ports()} />);
    expect(screen.getByRole('heading', { name: 'Reçu du règlement' })).toBeVisible();
    expect(screen.getByText('ETAB-VIR-77')).toBeVisible();
    expect(screen.getByText('0a1b2c3d')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Confirmer le règlement' })).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
    rerender(<BeneficiaryActions goal={paid} receipt={null} locale="en" ports={ports()} />);
    expect(screen.getByText('The transfer to the beneficiary is being executed by the institution.')).toBeVisible();
  });
});

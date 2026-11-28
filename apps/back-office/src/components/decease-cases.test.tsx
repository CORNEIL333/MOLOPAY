import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { DeceaseCasesPanel, type DeceaseCasesPorts } from './decease-cases';

const ACCOUNT_ID = '019ab100-0000-7000-8000-0000000000c1';
const CASE_ID = '019ab100-0000-7000-8000-0000000000d1';
const VALID_DIGEST = 'a'.repeat(64);

function makePorts(overrides: Partial<DeceaseCasesPorts> = {}): DeceaseCasesPorts {
  return {
    declareCase: vi.fn<DeceaseCasesPorts['declareCase']>(() =>
      Promise.resolve({
        ok: true,
        deceaseCase: {
          caseId: CASE_ID,
          accountId: ACCOUNT_ID,
          status: 'PENDING',
          declaredAt: '2026-11-20T10:00:00.000Z',
        },
      }),
    ),
    decideCase: vi.fn<DeceaseCasesPorts['decideCase']>(() =>
      Promise.resolve({
        ok: true,
        decision: { caseId: CASE_ID, decision: 'APPROVED', frozenGoals: 2 },
      }),
    ),
    ...overrides,
  };
}

describe('F-ACC-007 / I-7 · Déclaration et décision de décès à double contrôle', () => {
  it('déclare un dossier avec date passée, empreinte hexadécimale 64 car. et motif ; aucun gel avant 2e personne', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const { container } = render(<DeceaseCasesPanel ports={ports} todayIso="2026-11-28" />);

    expect(container.querySelector('.mp-glass')).toBeNull();
    expect(container.querySelector('.mp-liquid')).toBeNull();
    expect(screen.getByText(/ne pouvez pas approuver une opération que vous avez préparée/i)).toBeVisible();

    await user.type(screen.getByLabelText(/Identifiant du compte client/i), ACCOUNT_ID);
    await user.type(screen.getByLabelText(/Date du décès/i), '2026-11-15');
    await user.type(screen.getByLabelText(/Empreinte de l’acte/i), VALID_DIGEST);
    await user.type(screen.getByLabelText(/Motif de la déclaration/i), 'Acte présenté en agence par l’ayant droit');
    await user.click(screen.getByRole('button', { name: /Déclarer le dossier/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(CASE_ID);
    });
    expect(ports.declareCase).toHaveBeenCalledWith(ACCOUNT_ID, {
      deathDate: '2026-11-15',
      certificateSha256: VALID_DIGEST,
      reason: 'Acte présenté en agence par l’ayant droit',
    });
    await expectNoA11yViolations(container);
  });

  it('refuse sans appel : date future, empreinte mal formée ou rejet sans motif', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    render(<DeceaseCasesPanel ports={ports} todayIso="2026-11-28" />);

    await user.type(screen.getByLabelText(/Identifiant du compte client/i), ACCOUNT_ID);
    await user.type(screen.getByLabelText(/Date du décès/i), '2026-12-05');
    await user.type(screen.getByLabelText(/Empreinte de l’acte/i), 'ABCD');
    await user.type(screen.getByLabelText(/Motif de la déclaration/i), 'ab');
    await user.click(screen.getByRole('button', { name: /Déclarer le dossier/i }));
    expect(ports.declareCase).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Identifiant du dossier de décès/i), CASE_ID);
    await user.selectOptions(screen.getByLabelText(/^Décision$/i), 'REJECTED');
    await user.click(screen.getByRole('button', { name: /Enregistrer la décision/i }));
    expect(ports.decideCase).not.toHaveBeenCalled();
  });

  it('refuse : affiche le code métier exact MAKER_CANNOT_APPROVE (403) ou le nombre d’objectifs gelés après approbation', async () => {
    const user = userEvent.setup();
    const makerRefused = makePorts({
      decideCase: vi.fn<DeceaseCasesPorts['decideCase']>(() =>
        Promise.resolve({
          ok: false,
          problem: { title: 'Double contrôle violé', code: 'MAKER_CANNOT_APPROVE', detail: 'Le déclarant ne peut pas décider.', status: 403 },
        }),
      ),
    });
    const { rerender } = render(<DeceaseCasesPanel ports={makerRefused} todayIso="2026-11-28" />);

    await user.type(screen.getByLabelText(/Identifiant du dossier de décès/i), CASE_ID);
    await user.click(screen.getByRole('button', { name: /Enregistrer la décision/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('MAKER_CANNOT_APPROVE');
    });

    const approvedPorts = makePorts();
    rerender(<DeceaseCasesPanel ports={approvedPorts} todayIso="2026-11-28" locale="en" />);
    await user.click(screen.getByRole('button', { name: /Record decision/i }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('2');
    });
  });
});

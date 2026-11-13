import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { FundsAction, type FundsActionPort } from './funds-action';

const ID = '019aa900-0000-7000-8000-000000000001';

function port(result: Awaited<ReturnType<FundsActionPort>> = { ok: true }): ReturnType<typeof vi.fn<FundsActionPort>> {
  return vi.fn<FundsActionPort>(() => Promise.resolve(result));
}

describe('D49 / D50 / D46 actions maker-checker depuis la file', () => {
  it('décision : approuver envoie APPROVED sans motif', async () => {
    const user = userEvent.setup();
    const act = port();
    const done = vi.fn();
    render(<FundsAction flow="refunds" id={ID} stage="AWAITING_DECISION" act={act} onDone={done} />);
    await user.click(screen.getByRole('button', { name: 'Approuver' }));
    await waitFor(() => { expect(done).toHaveBeenCalled(); });
    expect(act).toHaveBeenCalledWith({ flow: 'refunds', id: ID, step: 'decision', body: { decision: 'APPROVED' } });
  });

  it('décision : refuser exige un motif, puis l’envoie', async () => {
    const user = userEvent.setup();
    const act = port();
    render(<FundsAction flow="beneficiary-payouts" id={ID} stage="AWAITING_DECISION" act={act} onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(screen.getByText(/Un refus exige un motif/)).toBeVisible();
    expect(act).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Motif'), 'pièce manquante');
    await user.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(act).toHaveBeenCalledWith({ flow: 'beneficiary-payouts', id: ID, step: 'decision', body: { decision: 'REJECTED', reason: 'pièce manquante' } });
  });

  it('instruction : envoi sans champ ; règlement marchand : la ville est jointe', async () => {
    const user = userEvent.setup();
    const act = port();
    const { unmount } = render(<FundsAction flow="refunds" id={ID} stage="AWAITING_INSTRUCTION" act={act} onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Émettre l’instruction signée' }));
    expect(act).toHaveBeenLastCalledWith({ flow: 'refunds', id: ID, step: 'instruction', body: {} });
    unmount();
    render(<FundsAction flow="settlements" id={ID} stage="AWAITING_INSTRUCTION" act={act} onDone={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Ville'), 'douala');
    await user.click(screen.getByRole('button', { name: 'Émettre l’instruction signée' }));
    expect(act).toHaveBeenLastCalledWith({ flow: 'settlements', id: ID, step: 'instruction', body: { cityId: 'douala' } });
  });

  it('exécution : référence de l’établissement obligatoire et en liste blanche', async () => {
    const user = userEvent.setup();
    const act = port();
    const { container } = render(<FundsAction flow="refunds" id={ID} stage="AWAITING_EXECUTION" act={act} onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’exécution' }));
    expect(screen.getByText(/Référence de l’établissement invalide/)).toBeVisible();
    await user.type(screen.getByLabelText('Référence de l’établissement'), 'ETAB-REMB-12');
    await user.selectOptions(screen.getByLabelText('Issue'), 'EXECUTED');
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’exécution' }));
    expect(act).toHaveBeenCalledWith({ flow: 'refunds', id: ID, step: 'execution', body: { outcome: 'EXECUTED', bankReference: 'ETAB-REMB-12' } });
    await expectNoA11yViolations(container);
  });

  it('refus du serveur (préparateur = décideur) : problème affiché, pas de rafraîchissement', async () => {
    const user = userEvent.setup();
    const act = port({ ok: false, problem: { title: 'Action interdite', detail: 'le préparateur ne peut pas décider' } });
    const done = vi.fn();
    render(<FundsAction flow="refunds" id={ID} stage="AWAITING_DECISION" act={act} onDone={done} />);
    await user.click(screen.getByRole('button', { name: 'Approuver' }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('le préparateur ne peut pas décider'); });
    expect(done).not.toHaveBeenCalled();
  });
});

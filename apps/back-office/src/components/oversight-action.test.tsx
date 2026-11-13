import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { OversightAction, type OversightPort } from './oversight-action';

const ID = '019aaa00-0000-7000-8000-000000000001';
const ok = (): ReturnType<typeof vi.fn<OversightPort>> => vi.fn<OversightPort>(() => Promise.resolve({ ok: true }));

describe('D53–D56 actions de contrôle depuis la file', () => {
  it('alerte de fraude : motif obligatoire, puis décision envoyée', async () => {
    const user = userEvent.setup();
    const act = ok();
    const done = vi.fn();
    render(<OversightAction kind="alert" id={ID} act={act} onDone={done} />);
    await user.click(screen.getByRole('button', { name: 'Classer sans suite' }));
    expect(screen.getByText(/Motif obligatoire/)).toBeVisible();
    expect(act).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Motif'), 'salaire fractionné vérifié');
    await user.click(screen.getByRole('button', { name: 'Classer sans suite' }));
    await waitFor(() => { expect(done).toHaveBeenCalled(); });
    expect(act).toHaveBeenCalledWith({ path: `/v1/backoffice/risk/alerts/${ID}/decision`, body: { decision: 'DISMISSED', reason: 'salaire fractionné vérifié' } });
  });

  it('écart : classe et explication proposées', async () => {
    const user = userEvent.setup();
    const act = ok();
    render(<OversightAction kind="gap" id={ID} act={act} onDone={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Classe'), 'FEES');
    await user.type(screen.getByLabelText('Explication'), 'frais de tenue de compte');
    await user.click(screen.getByRole('button', { name: 'Proposer la classe' }));
    expect(act).toHaveBeenCalledWith({ path: `/v1/backoffice/reconciliation/incidents/${ID}/classifications`, body: { classification: 'FEES', explanation: 'frais de tenue de compte' } });
  });

  it('suspens : justifier, ou valider la justification d’un autre', async () => {
    const user = userEvent.setup();
    const act = ok();
    render(<OversightAction kind="suspense" id={ID} act={act} onDone={vi.fn()} />);
    await user.type(screen.getByLabelText('Explication'), 'versement non identifié');
    await user.click(screen.getByRole('button', { name: 'Justifier' }));
    expect(act).toHaveBeenLastCalledWith({ path: `/v1/backoffice/reconciliation/suspense/${ID}/justification`, body: { explanation: 'versement non identifié' } });
    await user.click(screen.getByRole('button', { name: 'Valider la justification' }));
    expect(act).toHaveBeenLastCalledWith({ path: `/v1/backoffice/reconciliation/suspense/${ID}/approval`, body: {} });
  });

  it('réclamation : clôture avec une issue en liste fermée ; structure accessible', async () => {
    const user = userEvent.setup();
    const act = ok();
    const { container } = render(<OversightAction kind="complaint" id={ID} act={act} onDone={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Issue'), 'WITHDRAWN');
    await user.click(screen.getByRole('button', { name: 'Clore la réclamation' }));
    expect(act).toHaveBeenCalledWith({ path: `/v1/backoffice/complaints/${ID}/closure`, body: { outcome: 'WITHDRAWN' } });
    await expectNoA11yViolations(container);
  });
});

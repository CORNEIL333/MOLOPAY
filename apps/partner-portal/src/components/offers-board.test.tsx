import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../web-client/test/a11y';
import { OffersBoard, type OffersPorts, type PartnerOfferRow } from './offers-board';

const OFFER: PartnerOfferRow = {
  offerId: '019ab100-0000-7000-8000-0000000000f1',
  version: 2,
  title: 'Réfrigérateur 200 L',
  state: 'PUBLISHED',
  priceXaf: '150000',
  availabilityKind: 'IN_STOCK',
  stockUnits: 10,
  availableUnits: 7,
  publiclyVisible: true,
  updatedAt: '2026-11-01T09:00:00.000Z',
};

function ports(rows: readonly PartnerOfferRow[] = [OFFER]): OffersPorts {
  return { load: vi.fn<OffersPorts['load']>(() => Promise.resolve({ ok: true, rows })) };
}

describe('F-PRT-002 / D63 offres du partenaire (lecture)', () => {
  it('titre, prix FCFA, stock disponible sur déclaré, visibilité publique', async () => {
    render(<OffersBoard ports={ports()} />);
    const table = await screen.findByRole('table', { name: 'Offres' });
    const cells = within(within(table).getAllByRole('row')[1] as HTMLElement).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('Réfrigérateur 200 L');
    expect(cells[1]).toHaveTextContent(/150\s000\sFCFA/);
    expect(cells[2]).toHaveTextContent(/^7 \/ 10$/);
    expect(cells[3]).toHaveTextContent('Visible au catalogue');
  });

  it('précommande sans stock, brouillon sans titre, offre masquée', async () => {
    render(<OffersBoard ports={ports([{ ...OFFER, title: null, state: 'DRAFT', availabilityKind: 'PREORDER', stockUnits: null, availableUnits: null, publiclyVisible: false }])} />);
    const table = await screen.findByRole('table', { name: 'Offres' });
    const cells = within(within(table).getAllByRole('row')[1] as HTMLElement).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('Sans titre (brouillon)');
    expect(cells[2]).toHaveTextContent('Précommande');
    expect(cells[3]).toHaveTextContent('Non visible');
  });

  it('erreur : problème affiché', async () => {
    render(<OffersBoard ports={{ load: () => Promise.resolve({ ok: false, problem: { title: 'Authentification requise', status: 401 } }) }} />);
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('Authentification requise'); });
  });

  it('structure accessible', async () => {
    const { container } = render(<OffersBoard ports={ports()} />);
    await screen.findByRole('table', { name: 'Offres' });
    await expectNoA11yViolations(container);
  });
});

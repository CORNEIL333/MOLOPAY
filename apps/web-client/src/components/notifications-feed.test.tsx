import type { components } from '@achat/contracts/api';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsFeed } from './notifications-feed';

type Feed = components['schemas']['CustomerNotificationFeed'];

const PAGE_1: Feed = {
  items: [
    {
      notificationId: '11111111-1111-4111-8111-111111111111',
      eventType: 'PAYMENT_CONFIRMED',
      createdAt: '2026-11-20T10:00:00Z',
      title: 'Versement confirmé',
      body: 'Votre versement a bien été enregistré.',
    },
  ],
  nextBefore: '11111111-1111-4111-8111-111111111111',
  asOf: '2026-11-20T10:05:00Z',
};

describe('C5 / F-NOT-001 (Contrat 0.37.0) — NotificationsFeed', () => {
  it('affiche le fil, pagine avec le curseur before et reste accessible (axe-core)', async () => {
    const user = userEvent.setup();
    const loadMore = vi.fn().mockResolvedValue({
      ok: true,
      feed: {
        items: [
          {
            notificationId: '22222222-2222-4222-8222-222222222222',
            eventType: 'GOAL_FUNDED',
            createdAt: '2026-11-19T09:00:00Z',
            title: 'Objectif atteint',
            body: 'Votre objectif est financé à 100 %.',
          },
        ],
        nextBefore: null,
        asOf: '2026-11-20T10:06:00Z',
      } satisfies Feed,
    });

    const { container } = render(
      <NotificationsFeed initialFeed={PAGE_1} locale="fr" loadMore={loadMore} />,
    );

    expect(screen.getByText('Versement confirmé')).toBeInTheDocument();
    expect((await axe.run(container)).violations).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /Charger plus/i }));
    await waitFor(() => {
      expect(loadMore).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    });
    expect(screen.getByText('Objectif atteint')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Charger plus/i })).not.toBeInTheDocument();
  });

  it('affiche un état vide accessible en anglais', async () => {
    const { container } = render(
      <NotificationsFeed
        initialFeed={{ items: [], nextBefore: null, asOf: '2026-11-20T10:05:00Z' }}
        locale="en"
      />,
    );
    expect(screen.getByText(/No notifications yet/i)).toBeInTheDocument();
    expect((await axe.run(container)).violations).toHaveLength(0);
  });
});

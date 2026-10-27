import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../test/a11y';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';

describe('EmptyState', () => {
  it('explique l’absence de contenu et propose une action', () => {
    render(
      <EmptyState
        title="Aucun projet pour l’instant"
        description="Choisissez un univers pour commencer votre premier achat planifié."
        action={<Button>Voir le catalogue</Button>}
      />,
    );
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Aucun projet pour l’instant',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Voir le catalogue' }),
    ).toBeVisible();
  });

  it('est accessible', async () => {
    const { container } = render(
      <EmptyState title="Aucun versement" description="Votre historique est vide." />,
    );
    await expectNoA11yViolations(container);
  });
});

describe('ErrorState', () => {
  it('affiche le problème RFC 9457 sans exposer de détails techniques', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { container } = render(
      <ErrorState
        problem={{
          title: 'Service momentanément indisponible',
          detail: 'Réessayez dans quelques instants.',
          code: 'SERVICE_UNAVAILABLE',
          status: 503,
        }}
        retryLabel="Réessayer"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Service momentanément indisponible',
    );
    expect(screen.getByText('SERVICE_UNAVAILABLE')).toBeVisible();
    expect(screen.queryByText(/stack/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await expectNoA11yViolations(container);
  });

  it('n’affiche pas de bouton sans libellé de reprise', () => {
    render(
      <ErrorState problem={{ title: 'Connexion perdue', detail: 'Vérifiez votre réseau.' }} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../test/a11y';
import { VisualEffectsProvider } from './materials';
import {
  BottomSheet,
  ConfirmDialog,
  DataTable,
  DelayedSkeleton,
  FloatingNavBar,
  OfflineBanner,
  SlideToConfirm,
  ToastNotice,
} from './u1-surfaces';

describe('09_… § 3 · U1b Composants Web de dialogue, navigation, squelette et tableau (a11y, mode réduit, M-xx)', () => {
  it('BottomSheet (M-12) et ConfirmDialog (M-16) : rôle dialog, fermeture par Échap et focus initial prudent', async () => {
    const onCloseSheet = vi.fn();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { container } = render(
      <div>
        <BottomSheet open title="Détails de remise" closeLabel="Fermer" onClose={onCloseSheet}>
          <p>Contenu accessible</p>
        </BottomSheet>
        <ConfirmDialog
          open
          title="Annuler l’objectif ?"
          description="25 000 FCFA vous seront remboursés, sans frais."
          confirmLabel="Confirmer l’annulation"
          cancelLabel="Conserver"
          tone="danger"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </div>,
    );

    expect(screen.getByRole('dialog', { name: 'Détails de remise' })).toHaveAttribute('data-mp-motion', 'M-12');
    expect(screen.getByRole('alertdialog', { name: 'Annuler l’objectif ?' })).toHaveAttribute('data-mp-motion', 'M-16');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseSheet).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    await expectNoA11yViolations(container);
  });

  it('SlideToConfirm (M-23) : offre une alternative clavier/lecteur d’écran et refuse un double déclenchement verrouillé', async () => {
    const onConfirm = vi.fn();
    const { container, rerender } = render(
      <SlideToConfirm label="Glissez pour signer" confirmActionLabel="Signer au clavier" onConfirm={onConfirm} />,
    );

    expect(container.querySelector('[data-mp-motion="M-23"]')).not.toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Signer au clavier' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(<SlideToConfirm label="Glissez pour signer" confirmActionLabel="Signer au clavier" locked onConfirm={onConfirm} />);
    expect(screen.getByRole('button', { name: 'Signer au clavier' })).toBeDisabled();
    await expectNoA11yViolations(container);
  });

  it('DelayedSkeleton (M-30) : reste invisible avant 300 ms puis apparaît, figé en mode réduit', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <VisualEffectsProvider defaultSober>
          <DelayedSkeleton label="Chargement en cours" lines={2} />
        </VisualEffectsProvider>,
      );
      expect(container.querySelector('[data-mp-motion="M-30"]')).toBeNull();
      act(() => { vi.advanceTimersByTime(299); });
      expect(container.querySelector('[data-mp-motion="M-30"]')).toBeNull();
      act(() => { vi.advanceTimersByTime(1); });
      const skel = container.querySelector('[data-mp-motion="M-30"]');
      expect(skel).not.toBeNull();
      expect(skel).toHaveAttribute('data-mp-reduced', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ToastNotice (M-35), OfflineBanner (M-33), FloatingNavBar (M-11) et DataTable (M-34) : états et tri accessibles', async () => {
    expect(() => render(<ToastNotice message="Trop court" durationMs={1500} />)).toThrow('TOAST_DURATION_TOO_SHORT');

    const { container } = render(
      <VisualEffectsProvider>
        <ToastNotice tone="success" message="Accord signé" durationMs={4000} />
        <OfflineBanner date="28 nov." time="09:40" locale="fr" />
        <FloatingNavBar
          ariaLabel="Navigation principale"
          activeHref="/objectifs"
          items={[
            { href: '/', label: 'Catalogue', icon: 'grid' },
            { href: '/favoris', label: 'Favoris', icon: 'heart' },
            { href: '/objectifs', label: 'Objectifs', icon: 'target' },
            { href: '/compte', label: 'Profil', icon: 'user' },
          ]}
        />
        <DataTable
          caption="Commandes"
          emptyMessage="Aucune ligne"
          columns={[
            { key: 'title', header: 'Offre', sortable: true },
            { key: 'price', header: 'Prix', alignRight: true, sortable: true },
          ]}
          rows={[
            { id: '1', cells: { title: 'Cuisinière', price: 98000 } },
            { id: '2', cells: { title: 'Armoire', price: 65000 } },
          ]}
        />
      </VisualEffectsProvider>,
    );

    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Accord signé');
    expect(screen.getByText(/Pas de connexion\. Données du 28 nov\. à 09:40\./)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Objectifs' })).toHaveAttribute('aria-current', 'page');

    const sortBtn = screen.getByRole('button', { name: /Offre/ });
    await userEvent.setup().click(sortBtn);
    expect(sortBtn.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    await expectNoA11yViolations(container);
  });
});

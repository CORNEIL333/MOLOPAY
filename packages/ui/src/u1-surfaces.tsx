'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './classnames';
import { GlassSurface, useVisualEffects } from './materials';
import { IconButton, MpIcon, type MpIconName } from './u1-core';

/** 09_… § 3 #11 / M-12 : feuille du bas modale (focus initial, fermeture par Échap). */
export function BottomSheet({
  open,
  title,
  closeLabel = 'Fermer',
  onClose,
  children,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly closeLabel?: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): ReactElement | null {
  const titleId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="mp-overlay">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} data-mp-motion="M-12" className="mp-sheet">
        <div className="mp-sheet__grab" aria-hidden="true" />
        <div className="mp-ph">
          <h2 id={titleId}>{title}</h2>
          <IconButton icon="close" ariaLabel={closeLabel} onClick={onClose} />
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

/** 09_… § 3 #12 / M-16 : fenêtre de confirmation (`alertdialog`, focus initial sur l'action prudente). */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  pending = false,
  onConfirm,
  onCancel,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly tone?: 'primary' | 'danger';
  readonly pending?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactElement | null {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !pending) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); };
  }, [open, pending, onCancel]);
  if (!open) return null;
  return (
    <div className="mp-overlay">
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} data-mp-motion="M-16" className="mp-dialog">
        <h2 id={titleId}>{title}</h2>
        <p id={descId} className="mp-sub">{description}</p>
        <div className="mp-actions">
          <button ref={cancelRef} type="button" disabled={pending} className="achat-button achat-button--secondary" onClick={onCancel}>{cancelLabel}</button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={pending} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

/** 09_… § 3 #13 / M-23 : glisser pour confirmer + alternative complète clavier et lecteur d'écran. */
export function SlideToConfirm({
  label,
  confirmActionLabel,
  locked = false,
  onConfirm,
}: {
  readonly label: string;
  readonly confirmActionLabel?: string;
  readonly locked?: boolean;
  readonly onConfirm: () => void;
}): ReactElement {
  const sliderId = useId();
  const [pct, setPct] = useState(0);
  const firedRef = useRef(false);
  useEffect(() => { if (!locked) { firedRef.current = false; setPct(0); } }, [locked]);

  function trigger(): void {
    if (locked || firedRef.current) return;
    firedRef.current = true;
    setPct(100);
    onConfirm();
  }

  return (
    <div data-mp-motion="M-23" className={cx('mp-slide', locked && 'mp-slide--locked')}>
      <label className="mp-slide__label" htmlFor={sliderId}>{label}</label>
      <input
        id={sliderId}
        type="range"
        min={0}
        max={100}
        value={locked ? 100 : pct}
        disabled={locked}
        className="mp-slide__range"
        onChange={(e) => {
          const next = Number(e.target.value);
          setPct(next);
          if (next >= 88) trigger();
        }}
        onMouseUp={() => { if (pct < 88) setPct(0); }}
        onTouchEnd={() => { if (pct < 88) setPct(0); }}
      />
      <Button variant="secondary" disabled={locked} onClick={trigger}>
        {confirmActionLabel ?? label}
      </Button>
    </div>
  );
}

/** 09_… § 3 #14 / M-35 : notification temporaire (`role="status"`, ≥ 4 000 ms). */
export function ToastNotice({
  message,
  tone = 'info',
  durationMs = 4500,
  onDismiss,
}: {
  readonly message: string;
  readonly tone?: 'info' | 'success' | 'error';
  readonly durationMs?: number;
  readonly onDismiss?: () => void;
}): ReactElement {
  if (durationMs < 4000) throw new RangeError('TOAST_DURATION_TOO_SHORT');
  useEffect(() => {
    if (onDismiss === undefined) return undefined;
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => { window.clearTimeout(timer); };
  }, [durationMs, onDismiss]);
  const icon: MpIconName = tone === 'success' ? 'check' : tone === 'error' ? 'alert' : 'target';
  return (
    <div role="status" aria-live="polite" data-mp-motion="M-35" className={cx('mp-toast', `mp-toast--${tone}`)}>
      <MpIcon name={icon} size={16} />
      <span>{message}</span>
    </div>
  );
}

/** 09_… § 3 #15 / M-30 : squelette affiché après 300 ms seulement, figé en mode réduit. */
export function DelayedSkeleton({
  label = 'Chargement…',
  lines = 3,
}: {
  readonly label?: string;
  readonly lines?: number;
}): ReactElement | null {
  const { sober, reducedMotion } = useVisualEffects();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => { setVisible(true); }, 300);
    return () => { window.clearTimeout(t); };
  }, []);
  if (!visible) return null;
  const isReduced = sober || reducedMotion;
  return (
    <div role="status" aria-label={label} data-mp-motion="M-30" data-mp-reduced={isReduced ? 'true' : 'false'} className={cx('mp-skeleton', !isReduced && 'mp-skeleton--pulse')}>
      {Array.from({ length: Math.max(1, lines) }, (_, idx) => (
        <span key={String(idx)} className="mp-skeleton__line" />
      ))}
    </div>
  );
}

/** 09_… § 3 #16 / M-33 : bandeau hors ligne avec date et heure de dernière mise à jour. */
export function OfflineBanner({
  date,
  time,
  locale = 'fr',
}: {
  readonly date: string;
  readonly time: string;
  readonly locale?: 'fr' | 'en';
}): ReactElement {
  const msg = locale === 'en' ? `No connection. Data from ${date} at ${time}.` : `Pas de connexion. Données du ${date} à ${time}.`;
  return (
    <div role="status" data-mp-motion="M-33" className="mp-offline-banner">
      <MpIcon name="wifiOff" size={16} />
      <span>{msg}</span>
    </div>
  );
}

export type FloatingNavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: MpIconName;
};

/** 09_… § 3 #17 / M-11 : barre de navigation flottante (4 onglets sur GlassSurface, repli Sobre auto). */
export function FloatingNavBar({
  items,
  activeHref,
  ariaLabel,
  tone = 'light',
}: {
  readonly items: readonly FloatingNavItem[];
  readonly activeHref: string;
  readonly ariaLabel: string;
  readonly tone?: 'light' | 'dark';
}): ReactElement {
  return (
    <GlassSurface as="nav" ariaLabel={ariaLabel} tone={tone} className="mp-float-nav">
      <ul data-mp-motion="M-11" className="mp-float-nav__list">
        {items.map((item) => {
          const active = item.href === activeHref;
          return (
            <li key={item.href}>
              <a href={item.href} aria-current={active ? 'page' : undefined} className={cx('mp-float-nav__link', active && 'mp-float-nav__link--on')}>
                <MpIcon name={item.icon} size={18} />
                <span>{item.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </GlassSurface>
  );
}

export type DataTableColumn = {
  readonly key: string;
  readonly header: string;
  readonly alignRight?: boolean;
  readonly sortable?: boolean;
};

export type DataTableRow = {
  readonly id: string;
  readonly cells: Readonly<Record<string, string | number | ReactNode>>;
};

/** 09_… § 3 #18 / M-34 : tableau plat triable (portail et back-office, sans verre). */
export function DataTable({
  caption,
  columns,
  rows,
  loading = false,
  emptyMessage,
}: {
  readonly caption: string;
  readonly columns: readonly DataTableColumn[];
  readonly rows: readonly DataTableRow[];
  readonly loading?: boolean;
  readonly emptyMessage: string;
}): ReactElement {
  const [sort, setSort] = useState<{ readonly key: string; readonly asc: boolean } | null>(null);
  const sorted = useMemo(() => {
    if (sort === null) return rows;
    return [...rows].sort((a, b) => {
      const av = a.cells[sort.key];
      const bv = b.cells[sort.key];
      const toSortText = (val: unknown): string => (typeof val === 'string' || typeof val === 'number' ? String(val) : '');
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : toSortText(av).localeCompare(toSortText(bv), 'fr');
      return sort.asc ? cmp : -cmp;
    });
  }, [rows, sort]);

  if (loading) return <DelayedSkeleton label={caption} />;
  if (sorted.length === 0) return <p className="mp-banner">{emptyMessage}</p>;

  return (
    <div data-mp-motion="M-34" className="mp-panel mp-table-wrap">
      <table className="mp-table" aria-label={caption}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => {
              const ariaSort = !col.sortable
                ? undefined
                : sort?.key === col.key
                  ? (sort.asc ? 'ascending' : 'descending')
                  : 'none';
              return (
                <th key={col.key} scope="col" aria-sort={ariaSort} className={col.alignRight ? 'mp-num' : undefined}>
                  {col.sortable ? (
                    <button
                      type="button"
                      className="mp-table__sort"
                      onClick={() => { setSort((prev) => ({ key: col.key, asc: prev?.key === col.key ? !prev.asc : true })); }}
                    >
                      {col.header}
                    </button>
                  ) : col.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.id}>
              {columns.map((col) => (
                <td key={col.key} className={col.alignRight ? 'mp-num' : undefined}>{row.cells[col.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

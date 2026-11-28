import type { ReactElement, ReactNode } from 'react';
import { cx } from './classnames';

export type BrandRingProps = {
  readonly filled?: number;
  readonly size?: number;
  readonly tone?: 'light' | 'dark';
  readonly className?: string;
};

function ringArc(cx0: number, cy0: number, r: number, a0: number, a1: number): string {
  const x0 = (cx0 + r * Math.cos(a0)).toFixed(2);
  const y0 = (cy0 + r * Math.sin(a0)).toFixed(2);
  const x1 = (cx0 + r * Math.cos(a1)).toFixed(2);
  const y1 = (cy0 + r * Math.sin(a1)).toFixed(2);
  return `M${x0} ${y0} A${String(r)} ${String(r)} 0 0 1 ${x1} ${y1}`;
}

const SEGMENTS: readonly string[] = Array.from({ length: 8 }, (_, idx) => {
  const start = -Math.PI / 2 + idx * (Math.PI / 4) + 0.2;
  return ringArc(20, 20, 15, start, start + Math.PI / 4 - 0.4);
});

/** F7 / H8 : anneau de cotisation à 8 segments arrondis, séparé du mot-marque. */
export function BrandRing({ filled = 6, size = 26, tone = 'light', className }: BrandRingProps): ReactElement {
  const count = Math.max(0, Math.min(8, Math.trunc(filled)));
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      className={cx('mp-ring', tone === 'dark' ? 'mp-ring--dark' : 'mp-ring--light', className)}
    >
      {SEGMENTS.map((d, idx) => {
        const isFilled = idx < count;
        return (
          <path
            key={String(idx)}
            d={d}
            data-filled={isFilled ? 'true' : 'false'}
            className={isFilled ? 'mp-ring__seg mp-ring__seg--on' : 'mp-ring__seg mp-ring__seg--off'}
          />
        );
      })}
    </svg>
  );
}

export type StatusPillTone = 'ok' | 'warn' | 'bad' | 'info' | 'plain';

/** 09_… § 3 #19 : pastille de statut point + mot (sans verre, accessible). */
export function StatusPill({
  tone = 'plain',
  className,
  children,
}: {
  readonly tone?: StatusPillTone;
  readonly className?: string;
  readonly children: ReactNode;
}): ReactElement {
  return <span className={cx('mp-st', `mp-st--${tone}`, className)}>{children}</span>;
}

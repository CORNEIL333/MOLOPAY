import type { ReactElement, ReactNode } from 'react';
import { cx } from './classnames';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export type BadgeProps = {
  readonly children: ReactNode;
  readonly tone?: BadgeTone;
  readonly className?: string;
};

/** 09_… § 3 #19 : pastille de statut point + mot (sans verre). */
export function Badge({
  children,
  tone = 'neutral',
  className,
}: BadgeProps): ReactElement {
  return (
    <span
      data-mp-financial="true"
      className={cx(
        'achat-badge',
        tone !== 'neutral' && `achat-badge--${tone}`,
        className,
      )}
    >
      {children}
    </span>
  );
}

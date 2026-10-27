import type { ReactElement } from 'react';
import { cx } from './classnames';

export type BadgeTone = 'neutral' | 'success' | 'danger';

export type BadgeProps = {
  readonly children: string;
  readonly tone?: BadgeTone;
  readonly className?: string;
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: BadgeProps): ReactElement {
  return (
    <span
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

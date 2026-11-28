import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { cx } from './classnames';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly block?: boolean;
  readonly loading?: boolean;
  readonly children: ReactNode;
};

/** 09_… § 3 #3 / M-01 : bouton pilule ≥ 48 px (repos, pressé, désactivé, chargement). */
export function Button({
  variant = 'primary',
  block = false,
  loading = false,
  disabled,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      {...rest}
      type={type}
      disabled={Boolean(disabled) || loading}
      aria-busy={loading ? 'true' : undefined}
      data-mp-motion="M-01"
      className={cx(
        'achat-button',
        `achat-button--${variant === 'ghost' ? 'secondary' : variant}`,
        block && 'achat-button--block',
        className,
      )}
    >
      {children}
    </button>
  );
}

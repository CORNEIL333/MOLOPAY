import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { cx } from './classnames';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly block?: boolean;
  readonly children: ReactNode;
};

export function Button({
  variant = 'primary',
  block = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      {...rest}
      type={type}
      className={cx(
        'achat-button',
        `achat-button--${variant}`,
        block && 'achat-button--block',
        className,
      )}
    >
      {children}
    </button>
  );
}

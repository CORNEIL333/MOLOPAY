import type { ReactElement } from 'react';
import { cx } from './classnames';
import { formatXaf } from './format';

export type AmountXafProps = {
  /** Montant canonique renvoyé par l'API, en XAF entiers (« 25000 »). */
  readonly amount: string;
  readonly className?: string;
  readonly label?: string;
};

export function AmountXaf({
  amount,
  className,
  label,
}: AmountXafProps): ReactElement {
  return (
    <span className={cx('achat-amount', className)} aria-label={label}>
      {formatXaf(amount)}
    </span>
  );
}

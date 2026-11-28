'use client';

import { useId } from 'react';
import type { ReactElement } from 'react';
import { cx } from './classnames';
import { assertProgressPercent } from './progress';

export type ProgressBarProps = {
  /** Pourcentage déjà calculé par l'API, entier entre 0 et 100. */
  readonly percent: number;
  readonly label: string;
  readonly valueText?: string;
  readonly className?: string;
};

export function ProgressBar({
  percent,
  label,
  valueText,
  className,
}: ProgressBarProps): ReactElement {
  assertProgressPercent(percent);
  const labelId = useId();
  return (
    <div className={cx('achat-progress', className)}>
      <div className="achat-progress__label">
        <span id={labelId}>{label}</span>
        {valueText === undefined ? null : <span>{valueText}</span>}
      </div>
      <div
        className="achat-progress__track"
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={valueText}
      >
        <div
          className="achat-progress__fill"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

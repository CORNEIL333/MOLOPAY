import type { ReactElement, ReactNode } from 'react';
import { AmountXaf } from './AmountXaf';
import { Badge } from './Badge';
import type { BadgeTone } from './Badge';
import { ProgressBar } from './ProgressBar';

export type GoalCardProps = {
  readonly title: string;
  readonly headingLevel?: 2 | 3;
  readonly universeLabel: string;
  readonly cityLabel?: string;
  readonly statusLabel: string;
  readonly statusTone?: BadgeTone;
  readonly targetLabel: string;
  readonly targetAmount: string;
  readonly progressLabel: string;
  readonly progressPercent: number;
  readonly progressValueText?: string;
  readonly footer?: ReactNode;
};

export function GoalCard({
  title,
  headingLevel = 2,
  universeLabel,
  cityLabel,
  statusLabel,
  statusTone = 'neutral',
  targetLabel,
  targetAmount,
  progressLabel,
  progressPercent,
  progressValueText,
  footer,
}: GoalCardProps): ReactElement {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <article className="achat-goal-card">
      <ul className="achat-goal-card__meta">
        <li>{universeLabel}</li>
        {cityLabel === undefined ? null : <li>{cityLabel}</li>}
        <li>
          <Badge tone={statusTone}>{statusLabel}</Badge>
        </li>
      </ul>
      <Heading className="achat-goal-card__title">{title}</Heading>
      <div>
        <span className="achat-goal-card__label">{targetLabel}</span>
        <p className="achat-goal-card__target">
          <AmountXaf amount={targetAmount} />
        </p>
      </div>
      <ProgressBar
        percent={progressPercent}
        label={progressLabel}
        {...(progressValueText === undefined
          ? {}
          : { valueText: progressValueText })}
      />
      {footer === undefined ? null : (
        <div className="achat-goal-card__footer">{footer}</div>
      )}
    </article>
  );
}

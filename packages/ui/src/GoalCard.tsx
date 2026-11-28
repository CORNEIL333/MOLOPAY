import type { ReactElement, ReactNode } from 'react';
import { AmountXaf } from './AmountXaf';
import { Badge, type BadgeTone } from './Badge';
import { cx } from './classnames';
import { ProgressBar } from './ProgressBar';
import { CotisationRing, MpIcon, type MpIconName } from './u1-core';

export type GoalUniverseKey = 'essentials' | 'technology' | 'housing' | 'mobility';
export type GoalStatusKind = 'ACTIVE' | 'FUNDED' | 'CANCELLED' | 'LOCKED' | 'FROZEN';

export type GoalCardProps = {
  readonly title: string;
  readonly headingLevel?: 2 | 3;
  readonly universe?: GoalUniverseKey;
  readonly universeLabel?: string;
  readonly cityLabel?: string;
  readonly statusKind?: GoalStatusKind;
  readonly statusLabel: string;
  readonly statusTone?: BadgeTone;
  readonly targetLabel?: string;
  readonly targetAmount?: string;
  readonly targetXaf?: string;
  readonly savedXaf?: string;
  readonly progressLabel?: string;
  readonly progressPercent: number;
  readonly progressValueText?: string;
  readonly footer?: ReactNode;
};

const UNIVERSE_LABELS: Readonly<Record<GoalUniverseKey, string>> = {
  essentials: 'Essentiels',
  technology: 'Technologie',
  housing: 'Logement',
  mobility: 'Mobilité',
};

const STATUS_ICON: Readonly<Record<GoalStatusKind, MpIconName>> = {
  ACTIVE: 'target',
  FUNDED: 'check',
  CANCELLED: 'close',
  LOCKED: 'lock',
  FROZEN: 'alert',
};

/** 09_… § 3 #9 / M-13, M-22 : carte de projet par univers, état = icône + mot (jamais couleur seule). */
export function GoalCard({
  title,
  headingLevel = 2,
  universe,
  universeLabel,
  cityLabel,
  statusKind,
  statusLabel,
  statusTone = 'neutral',
  targetLabel = 'Objectif',
  targetAmount,
  targetXaf,
  savedXaf,
  progressLabel = 'Progression',
  progressPercent,
  progressValueText,
  footer,
}: GoalCardProps): ReactElement {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const resolvedTarget = targetAmount ?? targetXaf ?? '0';
  const resolvedUniverseLabel = universeLabel ?? (universe !== undefined ? UNIVERSE_LABELS[universe] : '');
  const segments = Math.round((Math.max(0, Math.min(100, progressPercent)) / 100) * 8);

  return (
    <article
      data-mp-motion="M-13"
      data-mp-universe={universe}
      className={cx('achat-goal-card', universe !== undefined && `mp-goal-card--${universe}`)}
    >
      <div className="mp-ph">
        <ul className="achat-goal-card__meta">
          {resolvedUniverseLabel !== '' ? <li>{resolvedUniverseLabel}</li> : null}
          {cityLabel === undefined ? null : <li>{cityLabel}</li>}
          <li>
            <Badge tone={statusTone}>
              {statusKind !== undefined ? <MpIcon name={STATUS_ICON[statusKind]} size={13} /> : null}
              <span>{statusLabel}</span>
            </Badge>
          </li>
        </ul>
        <CotisationRing filled={segments} size={34} />
      </div>
      <Heading className="achat-goal-card__title">{title}</Heading>
      <div>
        <span className="achat-goal-card__label">{targetLabel}</span>
        <p className="achat-goal-card__target">
          {savedXaf !== undefined ? <><AmountXaf amount={savedXaf} />{' / '}</> : null}
          <AmountXaf amount={resolvedTarget} />
        </p>
      </div>
      <ProgressBar
        percent={progressPercent}
        label={progressLabel}
        {...(progressValueText === undefined ? {} : { valueText: progressValueText })}
      />
      {footer === undefined ? null : <div className="achat-goal-card__footer">{footer}</div>}
    </article>
  );
}

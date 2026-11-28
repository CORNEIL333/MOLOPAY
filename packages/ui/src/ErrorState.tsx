import type { ReactElement } from 'react';
import { Button } from './Button';

/** Sous-ensemble affichable d'un problème RFC 9457 renvoyé par l'API. */
export type ProblemSummary = {
  readonly title: string;
  readonly detail?: string;
  readonly code?: string;
  readonly status?: number;
  readonly type?: string;
};

export type ErrorStateProps = {
  readonly problem: ProblemSummary;
  readonly headingLevel?: 2 | 3;
  readonly retryLabel?: string;
  readonly onRetry?: () => void;
};

export function ErrorState({
  problem,
  headingLevel = 2,
  retryLabel,
  onRetry,
}: ErrorStateProps): ReactElement {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section className="achat-state achat-state--error" role="alert">
      <Heading className="achat-state__title">{problem.title}</Heading>
      {problem.detail === undefined ? null : (
        <p className="achat-state__detail">{problem.detail}</p>
      )}
      {problem.code === undefined ? null : (
        <p className="achat-state__code">{problem.code}</p>
      )}
      {onRetry !== undefined && retryLabel !== undefined ? (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </section>
  );
}

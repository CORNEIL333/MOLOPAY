import type { ProblemSummary } from '@achat/contracts/client';
import { readProblem } from '@achat/contracts/client';

export function problemFrom(
  error: unknown,
  response: Response,
  fallbackTitle: string,
): ProblemSummary {
  return readProblem(error, response, fallbackTitle);
}

export function unexpectedProblem(fallbackTitle: string): ProblemSummary {
  return { title: fallbackTitle };
}

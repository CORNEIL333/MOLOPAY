export type ProblemSummary = {
  readonly title: string;
  readonly detail?: string;
  readonly code?: string;
  readonly status?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Extrait uniquement les champs affichables d'un problème RFC 9457.
 * `fallbackTitle` vient de l'écran, pour rester localisé.
 */
export function readProblem(
  error: unknown,
  response: Response,
  fallbackTitle: string,
): ProblemSummary {
  if (!isRecord(error)) {
    return { title: fallbackTitle, status: response.status };
  }
  const title =
    typeof error['title'] === 'string' && error['title'] !== ''
      ? error['title']
      : fallbackTitle;
  const detail =
    typeof error['detail'] === 'string' ? error['detail'] : undefined;
  const code = typeof error['code'] === 'string' ? error['code'] : undefined;
  return {
    title,
    status: response.status,
    ...(detail === undefined ? {} : { detail }),
    ...(code === undefined ? {} : { code }),
  };
}

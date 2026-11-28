import createClient from 'openapi-fetch';
import type { components, paths } from './api';

export { readProblem } from './problem';
export type { ProblemSummary } from './problem';

export type ApiPaths = paths;
export type ApiProblem = components['schemas']['Problem'];

export type ApiClientOptions = {
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Readonly<Record<string, string>>;
};

/**
 * Client typé du contrat OpenAPI. Les jetons de session restent dans des
 * cookies httpOnly : le client ne les lit ni ne les stocke.
 */
export function createApiClient(options: ApiClientOptions): ReturnType<
  typeof createClient<paths>
> {
  return createClient<paths>({
    baseUrl: options.baseUrl,
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json', ...options.headers },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;

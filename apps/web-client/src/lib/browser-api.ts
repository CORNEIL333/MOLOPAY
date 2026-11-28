import { createApiClient } from '@achat/contracts/client';

/** Client navigateur : même origine, cookies httpOnly inclus. */
export function browserApi(): ReturnType<typeof createApiClient> {
  return createApiClient({ baseUrl: '' });
}

import { createApiClient } from '@achat/contracts/client';
import { cookies } from 'next/headers';

const INTERNAL_API_URL =
  process.env['API_INTERNAL_URL'] ?? 'http://127.0.0.1:3000';

/**
 * Client serveur : transmet uniquement le cookie de session à l'API interne.
 * Aucun jeton n'est lu ni journalisé par le client web.
 */
export async function serverApi(): Promise<ReturnType<typeof createApiClient>> {
  const session = (await cookies()).get('client_session');
  const cookieHeader = session === undefined ? '' : `client_session=${encodeURIComponent(session.value)}`;
  return createApiClient({
    baseUrl: INTERNAL_API_URL,
    ...(cookieHeader === '' ? {} : { headers: { Cookie: cookieHeader } }),
  });
}
